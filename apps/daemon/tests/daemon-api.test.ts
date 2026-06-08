import { afterEach, describe, expect, test } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBuiltInProviders } from "@ccagent/provider";
import { DaemonClient } from "@ccagent/daemon-client";
import { createDatabase, SqliteTaskStore } from "@ccagent/storage";
import { MemorySecretStore, type SecretStore } from "@ccagent/secrets";
import { CCAgentError, ErrorCodes } from "@ccagent/core";
import type { ClaudeRunInput } from "@ccagent/runner";
import type { ProxyTaskConfig } from "@ccagent/proxy";
import { createDaemon } from "../src/index.js";

const daemons: Array<{ stop(): Promise<void> }> = [];

describe("daemon API", () => {
  afterEach(async () => {
    await Promise.all(daemons.splice(0).map((daemon) => daemon.stop()));
  });

  test("/health works without token and first startup generates bearer token", async () => {
    const daemon = await startDaemon({ port: 0 });
    daemons.push(daemon);

    const health = await fetch(`${daemon.baseUrl}/health`).then((res) => res.json());

    expect(health.status).toBe("ok");
    expect(daemon.authToken).toMatch(/^ccagent_/);
  });

  test("startup reuses an existing daemon bearer token instead of rotating it", async () => {
    const secretStore = new MemorySecretStore();
    const first = await startDaemon({ port: 0, secretStore });
    daemons.push(first);
    const firstToken = first.authToken;

    await first.stop();
    daemons.splice(daemons.indexOf(first), 1);

    const second = await startDaemon({ port: 0, secretStore });
    daemons.push(second);

    expect(second.authToken).toBe(firstToken);
    await expect(secretStore.get("ccagent/daemon/token")).resolves.toBe(firstToken);
  });

  test("startup reports a structured error when daemon auth token storage fails", async () => {
    await expect(
      startDaemon({
        port: 0,
        secretStore: new FailingSecretStore()
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.DaemonAuthUnavailable
    });
  });

  test("token rotation invalidates the old token and persists the new token", async () => {
    const secretStore = new MemorySecretStore();
    const daemon = await startDaemon({ port: 0, secretStore });
    daemons.push(daemon);
    const oldToken = daemon.authToken;
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: oldToken });

    const newToken = await client.rotateToken();

    expect(newToken).not.toBe(oldToken);
    await expect(secretStore.get("ccagent/daemon/token")).resolves.toBe(newToken);
    await expect(client.get("/providers")).resolves.toEqual([]);

    const oldClient = new DaemonClient({ baseUrl: daemon.baseUrl, token: oldToken });
    await expect(oldClient.get("/providers")).rejects.toMatchObject({
      code: "CCAGENT_UNAUTHORIZED"
    });
  });

  test("protected request without token fails", async () => {
    const daemon = await startDaemon({ port: 0 });
    daemons.push(daemon);

    const response = await fetch(`${daemon.baseUrl}/providers`);

    expect(response.status).toBe(401);
  });

  test("provider CRUD works through daemon client", async () => {
    const daemon = await startDaemon({ port: 0 });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await client.post("/providers", createBuiltInProviders().glm);
    const providers = (await client.get("/providers")) as any[];

    expect(providers[0].id).toBe("glm");

    await client.delete("/providers/glm");
    await expect(client.get("/providers")).resolves.toEqual([]);
  });

  test("POST /tasks stores runner output and logs", async () => {
    const daemon = await startDaemon({
      port: 0,
      settings: { workspace: { allowedRoots: ["D:/project"] } },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async (input) => {
          input.onStdout("runner output log");
          return { content: "runner task result", summary: "runner summary", raw: "{}" };
        },
        allocatePort: async () => ({ port: 41001, release: async () => undefined }),
        startProxy: async (config) => ({
          taskId: config.taskId,
          baseUrl: `http://127.0.0.1:${config.port}`,
          stop: async () => undefined
        })
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);
    await client.post("/providers/glm/secret", { value: "sk-provider" });

    const result = (await client.post("/tasks", {
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      prompt: "Review test.md",
      mode: "sync"
    })) as any;

    expect(result.status).toBe("ok");
    expect(result.logsRef).toBe(`ccagent://tasks/${result.taskId}/logs`);

    const output = (await client.get(`/tasks/${result.taskId}/output?maxBytes=1000`)) as any;
    const logs = (await client.get(`/tasks/${result.taskId}/logs?maxBytes=1000`)) as any;

    expect(output.content).toContain("runner task result");
    expect(logs.content).toContain("stdout: runner output log");
  });

  test("max concurrent task limit rejects excess tasks", async () => {
    const daemon = await startDaemon({
      port: 0,
      settings: {
        workspace: { allowedRoots: ["D:/project"] },
        tasks: { maxConcurrentTasks: 0, overflow: "reject" }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);

    await expect(
      client.post("/tasks", {
        provider: "glm",
        cwd: "D:/project",
        prompt: "Review test.md"
      })
    ).rejects.toMatchObject({ code: "CCAGENT_TASK_LIMIT" });
  });

  test("provider secret and provider test endpoints work", async () => {
    const daemon = await startDaemon({ port: 0 });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);

    await expect(
      client.post("/providers/glm/secret", { value: "sk-testabcd" })
    ).resolves.toMatchObject({ fingerprint: "sk-...abcd" });
    await expect(client.post("/providers/test", { provider: "glm" })).resolves.toMatchObject({
      status: "ok"
    });
  });

  test("workspace root settings endpoint updates daemon settings", async () => {
    const daemon = await startDaemon({ port: 0 });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await expect(
      client.post("/settings/workspace-roots", { allowedRoots: ["D:/project"] })
    ).resolves.toEqual({ allowedRoots: ["D:/project"] });
  });

  test("workspace root settings persist through config file across daemon restarts", async () => {
    const secretStore = new MemorySecretStore();
    const configPath = join(tmpdir(), `ccagent-config-${Date.now()}.json`);
    try {
      const first = await startDaemon({ port: 0, configPath, secretStore });
      daemons.push(first);
      const firstClient = new DaemonClient({ baseUrl: first.baseUrl, token: first.authToken });

      await firstClient.post("/settings/workspace-roots", { allowedRoots: ["D:/project"] });
      await first.stop();
      daemons.splice(daemons.indexOf(first), 1);

      const second = await startDaemon({
        port: 0,
        configPath,
        secretStore,
        orchestration: {
          checkClaudeBinary: fakeCheckClaudeBinary,
          runClaude: async () => ({ content: "persisted root task", raw: "{}" }),
          allocatePort: async () => ({ port: 41004, release: async () => undefined }),
          startProxy: async (config) => ({
            taskId: config.taskId,
            baseUrl: `http://127.0.0.1:${config.port}`,
            stop: async () => undefined
          })
        }
      });
      daemons.push(second);
      const secondClient = new DaemonClient({ baseUrl: second.baseUrl, token: second.authToken });
      await secondClient.post("/providers", createBuiltInProviders().glm);
      await secondClient.post("/providers/glm/secret", { value: "sk-provider" });

      await expect(
        secondClient.post("/tasks", {
          provider: "glm",
          cwd: "D:/project",
          prompt: "Uses persisted workspace root"
        })
      ).resolves.toMatchObject({ status: "ok", content: "persisted root task" });
    } finally {
      rmSync(configPath, { force: true });
    }
  });

  test("default empty allowed roots rejects task execution", async () => {
    const daemon = await startDaemon({
      port: 0,
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async () => {
          throw new Error("runner should not start when cwd is denied");
        }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);

    await expect(
      client.post("/tasks", {
        provider: "glm",
        cwd: "D:/project",
        prompt: "Review test.md"
      })
    ).rejects.toMatchObject({ code: ErrorCodes.PathDenied });
  });

  test("task file list cannot escape the validated cwd", async () => {
    const daemon = await startDaemon({
      port: 0,
      settings: { workspace: { allowedRoots: ["D:/project"] } },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async () => {
          throw new Error("runner should not start when file is denied");
        }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);

    await expect(
      client.post("/tasks", {
        provider: "glm",
        cwd: "D:/project/app",
        prompt: "Review file",
        files: ["../secret.txt"]
      })
    ).rejects.toMatchObject({ code: ErrorCodes.PathDenied });
  });

  test("cancel endpoint marks task as cancelled", async () => {
    const database = createDatabase(":memory:");
    const taskStore = new SqliteTaskStore(database);
    taskStore.createTask({
      id: "task_cancel",
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      prompt: "Review",
      startedAt: "2026-06-05T10:00:00.000Z"
    });
    const daemon = await startDaemon({ port: 0, taskStore });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await expect(client.post("/tasks/task_cancel/cancel")).resolves.toMatchObject({
      status: "cancelled"
    });
  });

  test("startup recovery marks persisted running tasks as recovered errors", async () => {
    const database = createDatabase(":memory:");
    const taskStore = new SqliteTaskStore(database);
    taskStore.createTask({
      id: "task_recover",
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      prompt: "Review",
      startedAt: "2026-06-05T10:00:00.000Z"
    });
    taskStore.updateTask("task_recover", { status: "running" });

    const daemon = await startDaemon({ port: 0, taskStore });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await expect(client.get("/tasks/task_recover")).resolves.toMatchObject({
      status: "error",
      errorJson: expect.stringContaining("CCAGENT_DAEMON_RECOVERED")
    });
  });

  test("file-backed daemon storage recovers running tasks across daemon restarts", async () => {
    const databasePath = join(tmpdir(), `ccagent-daemon-${Date.now()}.sqlite`);
    const database = createDatabase(databasePath);
    const taskStore = new SqliteTaskStore(database);
    taskStore.createTask({
      id: "task_file_recover",
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      prompt: "Review",
      startedAt: "2026-06-05T10:00:00.000Z"
    });
    taskStore.updateTask("task_file_recover", { status: "running" });
    database.close();

    try {
      const daemon = await startDaemon({ port: 0, databasePath });
      daemons.push(daemon);
      const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

      await expect(client.get("/tasks/task_file_recover")).resolves.toMatchObject({
        status: "error",
        errorJson: expect.stringContaining("CCAGENT_DAEMON_RECOVERED")
      });
      await daemon.stop();
      daemons.splice(daemons.indexOf(daemon), 1);
    } finally {
      rmSync(databasePath, { force: true });
      rmSync(`${databasePath}-shm`, { force: true });
      rmSync(`${databasePath}-wal`, { force: true });
    }
  });

  test("default daemon storage path is file-backed under APPDATA", async () => {
    const originalAppData = process.env.APPDATA;
    const appData = join(tmpdir(), `ccagent-appdata-${Date.now()}`);
    process.env.APPDATA = appData;
    try {
      const daemon = await createDaemon({
        port: 0,
        secretStore: new MemorySecretStore()
      });
      daemons.push(daemon);
      const expectedDb = join(appData, "CCAgent", "ccagent.sqlite");
      const expectedConfig = join(appData, "CCAgent", "config.json");
      expect(existsSync(expectedDb)).toBe(true);
      expect(existsSync(expectedConfig)).toBe(true);
      const configText = readFileSync(expectedConfig, "utf8");
      expect(configText).toContain('"allowedRoots": []');
      expect(configText).toContain('"authTokenRef": "ccagent/daemon/token"');
      expect(configText).not.toContain(daemon.authToken);
      await daemon.stop();
      daemons.splice(daemons.indexOf(daemon), 1);
    } finally {
      process.env.APPDATA = originalAppData;
      rmSync(appData, { recursive: true, force: true });
    }
  });

  test("openai-compatible task runs Claude through a task-local proxy", async () => {
    const runnerCalls: ClaudeRunInput[] = [];
    const proxyStarts: ProxyTaskConfig[] = [];
    const proxyStops: string[] = [];
    const portReleases: number[] = [];
    const daemon = await startDaemon({
      port: 0,
      settings: {
        workspace: { allowedRoots: ["D:/project"] },
        claude: { path: "fake-claude" },
        proxy: { portStart: 41000, portEnd: 41000 }
      },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async (input) => {
          runnerCalls.push(input);
          input.onStdout("runner stdout");
          return { content: "real runner result", summary: "real runner result", raw: "{}" };
        },
        allocatePort: async () => ({
          port: 41000,
          release: async () => {
            portReleases.push(41000);
          }
        }),
        startProxy: async (config) => {
          proxyStarts.push(config);
          return {
            taskId: config.taskId,
            baseUrl: `http://127.0.0.1:${config.port}`,
            stop: async () => {
              proxyStops.push(config.taskId);
            }
          };
        }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);
    await client.post("/providers/glm/secret", { value: "sk-provider" });

    const result = (await client.post("/tasks", {
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      prompt: "Review test.md"
    })) as any;

    expect(result).toMatchObject({ status: "ok", content: "real runner result" });
    expect(proxyStarts).toHaveLength(1);
    expect(proxyStarts[0]).toMatchObject({
      listenHost: "127.0.0.1",
      port: 41000,
      upstreamBaseUrl: createBuiltInProviders().glm.baseUrl,
      upstreamApiKey: "sk-provider",
      model: "glm-5.1"
    });
    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0]).toMatchObject({
      claudePath: "fake-claude",
      cwd: "D:/project",
      prompt: "Review test.md",
      outputFormat: "json"
    });
    expect(runnerCalls[0].env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:41000",
      ANTHROPIC_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.1",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.1"
    });
    expect(runnerCalls[0].env.ANTHROPIC_AUTH_TOKEN).toMatch(/^ccagent-local-/);
    expect(proxyStops).toEqual([result.taskId]);
    expect(portReleases).toEqual([41000]);

    const logs = (await client.get(`/tasks/${result.taskId}/logs?maxBytes=1000`)) as any;
    expect(logs.content).toContain("stdout: runner stdout");
  });

  test("anthropic-compatible task injects provider env without starting proxy", async () => {
    const runnerCalls: ClaudeRunInput[] = [];
    const provider = {
      ...createBuiltInProviders().glm,
      id: "anthropicish",
      mode: "anthropic-compatible" as const,
      baseUrl: "https://anthropic.example/v1",
      apiKeyRef: "ccagent/providers/anthropicish/api-key"
    };
    const daemon = await startDaemon({
      port: 0,
      settings: {
        claude: { path: "fake-claude" },
        workspace: { allowedRoots: ["D:/project"] }
      },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async (input) => {
          runnerCalls.push(input);
          return { content: "direct runner result", raw: "{}" };
        },
        startProxy: async () => {
          throw new Error("proxy should not start for anthropic-compatible providers");
        }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", provider);
    await client.post("/providers/anthropicish/secret", { value: "anthropic-key" });

    await expect(
      client.post("/tasks", {
        provider: "anthropicish",
        cwd: "D:/project",
        prompt: "Run direct"
      })
    ).resolves.toMatchObject({ status: "ok", content: "direct runner result" });

    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0].env).toMatchObject({
      ANTHROPIC_BASE_URL: "https://anthropic.example/v1",
      ANTHROPIC_AUTH_TOKEN: "anthropic-key",
      ANTHROPIC_MODEL: provider.models.review,
      ANTHROPIC_DEFAULT_SONNET_MODEL: provider.models.review,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.models.review,
      ANTHROPIC_DEFAULT_OPUS_MODEL: provider.models.review
    });
  });

  test("runner errors are persisted as structured task errors with logs", async () => {
    const daemon = await startDaemon({
      port: 0,
      settings: { workspace: { allowedRoots: ["D:/project"] } },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async (input) => {
          input.onStderr("runner failed");
          throw new CCAgentError(ErrorCodes.ParseError, "bad runner output", "raw");
        },
        allocatePort: async () => ({ port: 41002, release: async () => undefined }),
        startProxy: async (config) => ({
          taskId: config.taskId,
          baseUrl: `http://127.0.0.1:${config.port}`,
          stop: async () => undefined
        })
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);
    await client.post("/providers/glm/secret", { value: "sk-provider" });

    const result = (await client.post("/tasks", {
      provider: "glm",
      cwd: "D:/project",
      prompt: "Break"
    })) as any;

    expect(result).toMatchObject({
      status: "error",
      error: { code: ErrorCodes.ParseError, message: "bad runner output", detail: "raw" }
    });
    await expect(client.get(`/tasks/${result.taskId}`)).resolves.toMatchObject({
      status: "error",
      errorJson: expect.stringContaining(ErrorCodes.ParseError)
    });
    await expect(client.get(`/tasks/${result.taskId}/logs?maxBytes=1000`)).resolves.toMatchObject({
      content: expect.stringContaining("stderr: runner failed")
    });
  });

  test("cancel endpoint aborts an active runner task", async () => {
    let runnerSignal: AbortSignal | undefined;
    let activeTaskId = "";
    let resolveRunner: (() => void) | undefined;
    const runnerStarted = new Promise<void>((resolve) => {
      resolveRunner = resolve;
    });
    const daemon = await startDaemon({
      port: 0,
      settings: { workspace: { allowedRoots: ["D:/project"] } },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async (input) => {
          activeTaskId = input.taskId;
          runnerSignal = input.signal;
          resolveRunner?.();
          await new Promise((_resolve, reject) => {
            input.signal?.addEventListener(
              "abort",
              () => reject(new CCAgentError(ErrorCodes.Cancelled, "Claude task was cancelled")),
              { once: true }
            );
          });
          return { content: "unreachable", raw: "{}" };
        },
        allocatePort: async () => ({ port: 41003, release: async () => undefined }),
        startProxy: async (config) => ({
          taskId: config.taskId,
          baseUrl: `http://127.0.0.1:${config.port}`,
          stop: async () => undefined
        })
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);
    await client.post("/providers/glm/secret", { value: "sk-provider" });

    const taskPromise = client.post("/tasks", {
      provider: "glm",
      cwd: "D:/project",
      prompt: "Long task"
    }) as Promise<any>;
    await runnerStarted;
    expect(runnerSignal?.aborted).toBe(false);

    await expect(client.post(`/tasks/${activeTaskId}/cancel`)).resolves.toMatchObject({
      status: "cancelled"
    });
    expect(runnerSignal?.aborted).toBe(true);
    await expect(taskPromise).resolves.toMatchObject({ status: "cancelled" });
  });

  test("GET /tasks lists recent tasks for GUI dashboard", async () => {
    const database = createDatabase(":memory:");
    const taskStore = new SqliteTaskStore(database);
    taskStore.createTask({
      id: "task_list",
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      prompt: "Review",
      startedAt: "2026-06-05T10:00:00.000Z"
    });
    const daemon = await startDaemon({ port: 0, taskStore });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await expect(client.get("/tasks?limit=10")).resolves.toEqual([
      expect.objectContaining({ id: "task_list" })
    ]);
  });
});

async function fakeCheckClaudeBinary(): Promise<string> {
  return "claude 1.0.0";
}

type CreateDaemonOptions = Parameters<typeof createDaemon>[0];

function startDaemon(options: CreateDaemonOptions = {}) {
  return createDaemon({
    ...options,
    configPath: options.configPath ?? join(tmpdir(), `ccagent-config-${Date.now()}-${Math.random()}.json`),
    databasePath: options.databasePath ?? ":memory:",
    secretStore: options.secretStore ?? new MemorySecretStore()
  });
}

class FailingSecretStore implements SecretStore {
  async set(): Promise<void> {
    throw new Error("secret backend unavailable");
  }

  async get(): Promise<string> {
    throw new Error("secret backend unavailable");
  }

  async delete(): Promise<void> {
    throw new Error("secret backend unavailable");
  }

  async has(): Promise<boolean> {
    throw new Error("secret backend unavailable");
  }

  async fingerprint(): Promise<string> {
    throw new Error("secret backend unavailable");
  }
}
