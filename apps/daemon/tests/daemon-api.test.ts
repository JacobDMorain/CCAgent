import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
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

  test("startup syncs local operator provider config and secrets", async () => {
    const root = join(tmpdir(), `ccagent-local-config-${Date.now()}-${Math.random()}`);
    const localConfigPath = join(root, "ccagent.local-config.md");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      localConfigPath,
      [
        "# Local CCAgent config",
        "```dotenv",
        "GLM_API_KEY=sk-local-glm-secret",
        "DEEPSEEK_API_KEY=sk-local-deepseek-secret",
        "GLM_BASE_URL=https://ark.example.test/glm/v1",
        "DEEPSEEK_BASE_URL=https://deepseek.example.test",
        "```"
      ].join("\n")
    );
    const secretStore = new MemorySecretStore();

    const daemon = await startDaemon({
      port: 0,
      localConfigPath,
      secretStore
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    const providers = (await client.get("/providers")) as any[];

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "glm",
          baseUrl: "https://ark.example.test/glm/v1"
        }),
        expect.objectContaining({
          id: "deepseek",
          baseUrl: "https://deepseek.example.test"
        })
      ])
    );
    await expect(secretStore.get("providers/glm/api-key")).resolves.toBe("sk-local-glm-secret");
    await expect(secretStore.get("providers/deepseek/api-key")).resolves.toBe(
      "sk-local-deepseek-secret"
    );
  });

  test("sync-local-config endpoint applies operator config to a running daemon", async () => {
    const root = join(tmpdir(), `ccagent-local-config-endpoint-${Date.now()}-${Math.random()}`);
    const localConfigPath = join(root, "ccagent.local-config.md");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      localConfigPath,
      [
        "# Local CCAgent config",
        "GLM_API_KEY=sk-endpoint-glm-secret",
        "GLM_BASE_URL=https://ark.example.test/runtime/v1"
      ].join("\n")
    );
    const secretStore = new MemorySecretStore();
    const daemon = await startDaemon({ port: 0, secretStore });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await expect(
      client.post("/providers/sync-local-config", { path: localConfigPath })
    ).resolves.toMatchObject({
      synced: true,
      providers: ["glm", "deepseek"]
    });
    const providers = (await client.get("/providers")) as any[];

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "glm",
          baseUrl: "https://ark.example.test/runtime/v1"
        })
      ])
    );
    await expect(secretStore.get("providers/glm/api-key")).resolves.toBe("sk-endpoint-glm-secret");
  });

  test("sync-local-config endpoint persists allowed roots from local operator config", async () => {
    const root = join(tmpdir(), `ccagent-local-config-roots-${Date.now()}-${Math.random()}`);
    const localConfigPath = join(root, "ccagent.local-config.md");
    const configPath = join(root, "config.json");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      localConfigPath,
      [
        "# Local CCAgent config",
        "```dotenv",
        "CCAGENT_ALLOWED_ROOTS=D:/CodeAnalyze; D:/Project With Spaces",
        "```"
      ].join("\n")
    );
    const daemon = await startDaemon({ port: 0, configPath });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await expect(
      client.post("/providers/sync-local-config", { path: localConfigPath })
    ).resolves.toMatchObject({
      synced: true,
      allowedRoots: ["D:/CodeAnalyze", "D:/Project With Spaces"]
    });

    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    expect(saved.workspace.allowedRoots).toEqual(["D:/CodeAnalyze", "D:/Project With Spaces"]);
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

  test("provider test stores secrets and performs a lightweight upstream probe", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const daemon = await startDaemon({
      port: 0,
      providerTestFetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ id: "chatcmpl-test" }), { status: 200 });
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);

    await expect(
      client.post("/providers/glm/secret", { value: "sk-testabcd" })
    ).resolves.toMatchObject({ fingerprint: "sk-...abcd" });
    await expect(client.post("/providers/test", { provider: "glm" })).resolves.toMatchObject({
      status: "ok",
      model: "glm-5.1"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${createBuiltInProviders().glm.baseUrl}/chat/completions`);
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer sk-testabcd"
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: "glm-5.1",
      max_tokens: 1
    });
  });

  test("provider test uses Anthropic messages endpoint for anthropic-compatible providers", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const daemon = await startDaemon({
      port: 0,
      providerTestFetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ id: "msg-test" }), { status: 200 });
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", {
      ...createBuiltInProviders().deepseek,
      mode: "anthropic-compatible",
      baseUrl: "https://api.deepseek.com/anthropic",
      auth: { header: "x-api-key", scheme: "Bearer" },
      models: { default: "deepseek-v4-pro[1m]", review: "deepseek-v4-pro[1m]" }
    });
    await client.post("/providers/deepseek/secret", { value: "sk-deepseek" });

    await expect(client.post("/providers/test", { provider: "deepseek" })).resolves.toMatchObject({
      status: "ok",
      model: "deepseek-v4-pro[1m]"
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.deepseek.com/anthropic/v1/messages");
    expect(calls[0].init?.headers).toMatchObject({
      "x-api-key": "sk-deepseek",
      "anthropic-version": "2023-06-01"
    });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      model: "deepseek-v4-pro[1m]",
      max_tokens: 1
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

  test("runtime settings endpoint updates Claude and Codex CLI paths", async () => {
    const daemon = await startDaemon({ port: 0 });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await expect(client.get("/settings/runtime")).resolves.toMatchObject({
      claudePath: "claude",
      codexPath: "codex.cmd"
    });
    await expect(
      client.post("/settings/runtime", {
        claudePath: "custom-claude.cmd",
        codexPath: "custom-codex.cmd"
      })
    ).resolves.toMatchObject({
      claudePath: "custom-claude.cmd",
      codexPath: "custom-codex.cmd"
    });
  });

  test("codex test endpoint checks configured Codex CLI path", async () => {
    const daemon = await startDaemon({
      port: 0,
      settings: {
        codex: { path: process.execPath }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await expect(client.post("/settings/codex/test")).resolves.toMatchObject({
      status: "ok",
      codexPath: process.execPath
    });
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

  test("POST /review-batches starts async review tasks and returns persisted batch status", async () => {
    const runnerStarted: string[] = [];
    const daemon = await startDaemon({
      port: 0,
      settings: { workspace: { allowedRoots: ["D:/project"] } },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async (input) => {
          runnerStarted.push(input.taskId);
          return { content: `review for ${input.taskId}`, raw: "{}" };
        },
        allocatePort: async () => ({ port: 41005, release: async () => undefined }),
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
    await client.post("/providers", { ...createBuiltInProviders().deepseek, baseUrl: "https://deepseek.example" });
    await client.post("/providers/deepseek/secret", { value: "sk-provider-2" });

    const batch = (await client.post("/review-batches", {
      cwd: "D:/project",
      file: "test.md",
      reviewStyle: "bugs",
      reviewers: [{ provider: "glm" }, { provider: "deepseek" }]
    })) as any;

    expect(batch).toMatchObject({
      status: "running",
      batchId: expect.stringMatching(/^batch_/),
      tasks: [
        { provider: "glm", taskId: expect.stringMatching(/^task_/) },
        { provider: "deepseek", taskId: expect.stringMatching(/^task_/) }
      ]
    });
    await waitFor(async () => runnerStarted.length === 2);
    await expect(client.get(`/review-batches/${batch.batchId}`)).resolves.toMatchObject({
      status: "ok",
      batchId: batch.batchId,
      tasks: [
        { provider: "glm", status: "ok" },
        { provider: "deepseek", status: "ok" }
      ]
    });
  });

  test("review batch status and output survive daemon restart", async () => {
    const databasePath = join(tmpdir(), `ccagent-batches-${Date.now()}.sqlite`);
    const secretStore = new MemorySecretStore();
    const configPath = join(tmpdir(), `ccagent-batches-${Date.now()}.json`);
    let second: Awaited<ReturnType<typeof startDaemon>> | undefined;

    try {
      const first = await startDaemon({
        port: 0,
        databasePath,
        configPath,
        secretStore,
        settings: { workspace: { allowedRoots: ["D:/project"] } },
        orchestration: {
          checkClaudeBinary: fakeCheckClaudeBinary,
          runClaude: async (input) => ({ content: `persisted review ${input.taskId}`, raw: "{}" }),
          allocatePort: async () => ({ port: 41006, release: async () => undefined }),
          startProxy: async (config) => ({
            taskId: config.taskId,
            baseUrl: `http://127.0.0.1:${config.port}`,
            stop: async () => undefined
          })
        }
      });
      daemons.push(first);
      const firstClient = new DaemonClient({ baseUrl: first.baseUrl, token: first.authToken });
      await firstClient.post("/providers", createBuiltInProviders().glm);
      await firstClient.post("/providers/glm/secret", { value: "sk-provider" });

      const batch = (await firstClient.post("/review-batches", {
        cwd: "D:/project",
        file: "test.md",
        reviewers: [{ provider: "glm", model: "glm-5.1" }]
      })) as any;
      await waitFor(async () => {
        const status = (await firstClient.get(`/review-batches/${batch.batchId}`)) as any;
        return status.status === "ok";
      });
      await first.stop();
      daemons.splice(daemons.indexOf(first), 1);

      second = await startDaemon({
        port: 0,
        databasePath,
        configPath,
        secretStore
      });
      daemons.push(second);
      const secondClient = new DaemonClient({ baseUrl: second.baseUrl, token: second.authToken });

      await expect(secondClient.get(`/review-batches/${batch.batchId}`)).resolves.toMatchObject({
        status: "ok",
        batchId: batch.batchId,
        tasks: [{ provider: "glm", model: "glm-5.1", status: "ok" }]
      });
      await expect(
        secondClient.get(`/review-batches/${batch.batchId}/output?maxBytes=1000`)
      ).resolves.toMatchObject({
        status: "ok",
        reviews: [
          {
            provider: "glm",
            model: "glm-5.1",
            status: "ok",
            content: expect.stringContaining("persisted review")
          }
        ]
      });
    } finally {
      if (second) {
        await second.stop();
        daemons.splice(daemons.indexOf(second), 1);
      }
      rmSync(configPath, { force: true });
      rmSync(databasePath, { force: true });
      rmSync(`${databasePath}-shm`, { force: true });
      rmSync(`${databasePath}-wal`, { force: true });
    }
  });

  test("prompt template API exposes seeded defaults and CRUD", async () => {
    const daemon = await startDaemon({ port: 0 });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    const defaults = (await client.get("/prompt-templates")) as any[];
    expect(defaults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "default-claude-review-full", kind: "claude-review" }),
        expect.objectContaining({ id: "default-codex-edit", kind: "codex-edit" })
      ])
    );

    await expect(
      client.post("/prompt-templates", {
        id: "custom-codex",
        kind: "codex-edit",
        name: "Custom Codex",
        description: "Custom Codex edit template",
        version: 1,
        content: "Read {reviewPacket}",
        requiredVariables: ["reviewPacket"],
        isDefault: false,
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T10:00:00.000Z"
      })
    ).resolves.toMatchObject({ id: "custom-codex" });

    await expect(client.delete("/prompt-templates/custom-codex")).resolves.toEqual({ ok: true });
  });

  test("startup upgrades older built-in default prompt templates without overwriting custom templates", async () => {
    const databasePath = join(tmpdir(), `ccagent-template-upgrade-${Date.now()}-${Math.random()}.sqlite`);
    const configPath = join(tmpdir(), `ccagent-template-upgrade-${Date.now()}-${Math.random()}.json`);
    let daemon = await startDaemon({ port: 0, databasePath, configPath });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await client.post("/prompt-templates", {
      id: "default-codex-edit",
      kind: "codex-edit",
      name: "Old Codex",
      description: "Old default Codex edit template",
      version: 1,
      content: "Old default template {reviewPacket}",
      requiredVariables: ["reviewPacket"],
      isDefault: true,
      createdAt: "2026-06-08T10:00:00.000Z",
      updatedAt: "2026-06-08T10:00:00.000Z"
    });
    await client.post("/prompt-templates", {
      id: "custom-codex",
      kind: "codex-edit",
      name: "Custom Codex",
      description: "Custom Codex edit template",
      version: 1,
      content: "Custom template {reviewPacket}",
      requiredVariables: ["reviewPacket"],
      isDefault: false,
      createdAt: "2026-06-08T10:00:00.000Z",
      updatedAt: "2026-06-08T10:00:00.000Z"
    });

    await daemon.stop();
    daemons.splice(daemons.indexOf(daemon), 1);
    daemon = await startDaemon({ port: 0, databasePath, configPath });
    daemons.push(daemon);
    const restartedClient = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    const templates = (await restartedClient.get("/prompt-templates")) as any[];

    expect(templates.find((template) => template.id === "default-codex-edit")).toMatchObject({
      version: 2,
      content: expect.stringContaining("adjudicate the provider review findings")
    });
    expect(templates.find((template) => template.id === "custom-codex")).toMatchObject({
      content: "Custom template {reviewPacket}"
    });

    await daemon.stop();
    daemons.splice(daemons.indexOf(daemon), 1);
    rmSync(configPath, { force: true });
    rmSync(databasePath, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    rmSync(`${databasePath}-wal`, { force: true });
  });

  test("automation run completes multi-provider review, packet generation, and codex edit", async () => {
    const codexPrompts: string[] = [];
    const daemon = await startDaemon({
      port: 0,
      settings: { workspace: { allowedRoots: ["D:/project"] } },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async (input) => ({
          content: `review result for ${input.prompt.includes("Provider: glm") ? "glm" : "deepseek"}`,
          raw: "{}"
        }),
        allocatePort: async () => ({ port: 41007, release: async () => undefined }),
        startProxy: async (config) => ({
          taskId: config.taskId,
          baseUrl: `http://127.0.0.1:${config.port}`,
          stop: async () => undefined
        })
      },
      automationOrchestration: {
        runCodex: async (input) => {
          codexPrompts.push(input.prompt);
          if (codexPrompts.length === 2) {
            return { exitCode: 0, content: "## Applied\n- User-facing summary only" };
          }
          return { exitCode: 0, content: "Codex applied review suggestions" };
        }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);
    await client.post("/providers/glm/secret", { value: "sk-provider" });
    await client.post("/providers", { ...createBuiltInProviders().deepseek, baseUrl: "https://deepseek.example" });
    await client.post("/providers/deepseek/secret", { value: "sk-provider-2" });

    const run = (await client.post("/automation-runs", {
      cwd: "D:/project",
      file: "docs/handoff.md",
      reviewers: [{ provider: "glm" }, { provider: "deepseek" }],
      claudeTemplateId: "default-claude-review-full",
      codexTemplateId: "default-codex-edit"
    })) as any;

    expect(run).toMatchObject({ status: "queued", fullyAuto: true });
    await waitFor(async () => {
      const status = (await client.get(`/automation-runs/${run.id}`)) as any;
      return status.status === "done";
    });

    const completed = (await client.get(`/automation-runs/${run.id}`)) as any;
    expect(completed).toMatchObject({
      status: "done",
      providers: [
        { provider: "glm", status: "succeeded" },
        { provider: "deepseek", status: "succeeded" }
      ],
      codexTask: { status: "ok" }
    });
    expect(completed.reviewPacketPath).toContain("review-packet.md");
    expect(codexPrompts).toHaveLength(2);
    expect(codexPrompts[0]).toContain(completed.reviewPacketPath);
    expect(codexPrompts[0]).toContain("adjudicate the provider review findings");
    expect(codexPrompts[0]).toContain("Do not replace the target document with a different file");
    expect(codexPrompts[1]).toContain("codex-decision-summary.md");
    expect(codexPrompts[1]).toContain("review-packet.md");
    expect(codexPrompts[1]).toContain("codex-output.md");
    expect(codexPrompts[1]).toContain("diff.patch");

    await expect(client.get(`/automation-runs/${run.id}/output?maxBytes=5000`)).resolves.toMatchObject({
      content: expect.stringContaining("## Applied\n- User-facing summary only")
    });
  });

  test("automation run sends the full Codex prompt through stdin for Windows command shims", async () => {
    const root = join(tmpdir(), `ccagent-codex-stdin-${Date.now()}-${Math.random()}`);
    const capturePath = join(root, "captured-codex.jsonl");
    const fakeCodexJs = join(root, "fake-codex.js");
    const fakeCodexCmd = join(root, "fake-codex.cmd");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "test.md"), "# Target\n", "utf8");
    writeFileSync(
      fakeCodexJs,
      [
        "const fs = require('node:fs');",
        "let stdin = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => { stdin += chunk; });",
        "process.stdin.on('end', () => {",
        "  fs.appendFileSync(process.env.CCAGENT_FAKE_CODEX_CAPTURE, JSON.stringify({ argv: process.argv.slice(2), stdin }) + '\\n');",
        "  process.stdout.write('fake codex completed');",
        "  process.stderr.write('OpenAI Codex transcript should stay in stderr log');",
        "});"
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      fakeCodexCmd,
      `@echo off\r\n"${process.execPath}" "${fakeCodexJs}" %*\r\n`,
      "utf8"
    );
    process.env.CCAGENT_FAKE_CODEX_CAPTURE = capturePath;
    let daemon: Awaited<ReturnType<typeof startDaemon>> | undefined;

    try {
      daemon = await startDaemon({
        port: 0,
        settings: {
          workspace: { allowedRoots: [root] },
          codex: { path: fakeCodexCmd }
        },
        orchestration: {
          checkClaudeBinary: fakeCheckClaudeBinary,
          runClaude: async () => ({ content: "provider review output", raw: "{}" }),
          allocatePort: async () => ({ port: 41011, release: async () => undefined }),
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

      const run = (await client.post("/automation-runs", {
        cwd: root,
        file: join(root, "test.md"),
        reviewers: [{ provider: "glm" }],
        claudeTemplateId: "default-claude-review-full",
        codexTemplateId: "default-codex-edit",
        timeoutMs: 5000
      })) as any;

      await waitFor(async () => ((await client.get(`/automation-runs/${run.id}`)) as any).status === "done");
      const capturedCalls = readFileSync(capturePath, "utf8")
        .trim()
        .split(/\r?\n/)
        .map((line) => JSON.parse(line));
      const captured = capturedCalls[0];
      const normalizedTarget = join(root, "test.md").replace(/\\/g, "/");

      expect(captured.argv).toContain("-");
      expect(captured.stdin).toContain("Your job is to adjudicate the provider review findings");
      expect(captured.stdin).toContain(`Target document: ${normalizedTarget}`);
      expect(captured.stdin).toContain("Review packet:");
      expect(capturedCalls[1].stdin).toContain("codex-decision-summary.md");
      const output = (await client.get(`/automation-runs/${run.id}/output?maxBytes=5000`)) as any;
      const summarySection = extractRunOutputSection(output.content, "codex-decision-summary.md");
      expect(summarySection).toBe("fake codex completed");
      expect(summarySection).not.toContain("OpenAI Codex transcript should stay in stderr log");
    } finally {
      delete process.env.CCAGENT_FAKE_CODEX_CAPTURE;
      if (daemon) {
        await daemon.stop();
        daemons.splice(daemons.indexOf(daemon), 1);
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("automation run captures target document snapshot diff for untracked target files", async () => {
    const root = join(tmpdir(), `ccagent-target-diff-${Date.now()}-${Math.random()}`);
    const targetPath = join(root, "test.md");
    let codexCalls = 0;
    let summaryPrompt = "";
    mkdirSync(root, { recursive: true });
    writeFileSync(targetPath, "# Before\n", "utf8");
    writeFileSync(join(root, "other.md"), "# Existing dirty file\n", "utf8");

    try {
      const daemon = await startDaemon({
        port: 0,
        settings: { workspace: { allowedRoots: [root] } },
        orchestration: {
          checkClaudeBinary: fakeCheckClaudeBinary,
          runClaude: async () => ({ content: "provider review output", raw: "{}" }),
          allocatePort: async () => ({ port: 41012, release: async () => undefined }),
          startProxy: async (config) => ({
            taskId: config.taskId,
            baseUrl: `http://127.0.0.1:${config.port}`,
            stop: async () => undefined
          })
        },
        automationOrchestration: {
          runCodex: async (input) => {
            codexCalls += 1;
            if (codexCalls === 1) {
              writeFileSync(targetPath, "# After\n", "utf8");
              writeFileSync(join(root, "other.md"), "# Existing dirty file changed\n", "utf8");
              return { exitCode: 0, content: "Edited target" };
            }
            summaryPrompt = input.prompt;
            return { exitCode: 0, content: "summary" };
          }
        }
      });
      daemons.push(daemon);
      const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
      await client.post("/providers", createBuiltInProviders().glm);
      await client.post("/providers/glm/secret", { value: "sk-provider" });

      const run = (await client.post("/automation-runs", {
        cwd: root,
        file: targetPath,
        reviewers: [{ provider: "glm" }],
        claudeTemplateId: "default-claude-review-full",
        codexTemplateId: "default-codex-edit"
      })) as any;

      await waitFor(async () => ((await client.get(`/automation-runs/${run.id}`)) as any).status === "done");
      const output = (await client.get(`/automation-runs/${run.id}/output?maxBytes=10000`)) as any;
      const diff = extractRunOutputSection(output.content, "diff.patch");

      expect(summaryPrompt).toContain("diff.patch");
      expect(diff).toContain("Target document snapshot diff");
      expect(diff).toContain("test.md");
      expect(diff).toContain("-# Before");
      expect(diff).toContain("+# After");
      expect(diff).not.toContain("other.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("automation run continues to codex when one provider fails", async () => {
    let codexCalled = false;
    const daemon = await startDaemon({
      port: 0,
      settings: { workspace: { allowedRoots: ["D:/project"] } },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async (input) => {
          if (input.prompt.includes("Provider: deepseek")) {
            throw new CCAgentError(ErrorCodes.ParseError, "bad provider output");
          }
          return { content: "glm review ok", raw: "{}" };
        },
        allocatePort: async () => ({ port: 41008, release: async () => undefined }),
        startProxy: async (config) => ({
          taskId: config.taskId,
          baseUrl: `http://127.0.0.1:${config.port}`,
          stop: async () => undefined
        })
      },
      automationOrchestration: {
        runCodex: async () => {
          codexCalled = true;
          return { exitCode: 0, content: "Codex edited despite partial failure" };
        }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);
    await client.post("/providers/glm/secret", { value: "sk-provider" });
    await client.post("/providers", { ...createBuiltInProviders().deepseek, baseUrl: "https://deepseek.example" });
    await client.post("/providers/deepseek/secret", { value: "sk-provider-2" });

    const run = (await client.post("/automation-runs", {
      cwd: "D:/project",
      file: "docs/handoff.md",
      reviewers: [{ provider: "glm" }, { provider: "deepseek" }],
      claudeTemplateId: "default-claude-review-full",
      codexTemplateId: "default-codex-edit"
    })) as any;

    await waitFor(async () => ((await client.get(`/automation-runs/${run.id}`)) as any).status === "done");
    const completed = (await client.get(`/automation-runs/${run.id}`)) as any;
    expect(codexCalled).toBe(true);
    expect(completed.providers).toEqual([
      expect.objectContaining({ provider: "glm", status: "succeeded" }),
      expect.objectContaining({ provider: "deepseek", status: "failed" })
    ]);
  });

  test("automation run fails without codex when all providers fail", async () => {
    let codexCalled = false;
    const daemon = await startDaemon({
      port: 0,
      settings: { workspace: { allowedRoots: ["D:/project"] } },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async () => {
          throw new CCAgentError(ErrorCodes.ParseError, "bad provider output");
        },
        allocatePort: async () => ({ port: 41009, release: async () => undefined }),
        startProxy: async (config) => ({
          taskId: config.taskId,
          baseUrl: `http://127.0.0.1:${config.port}`,
          stop: async () => undefined
        })
      },
      automationOrchestration: {
        runCodex: async () => {
          codexCalled = true;
          return { exitCode: 0, content: "unreachable" };
        }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);
    await client.post("/providers/glm/secret", { value: "sk-provider" });

    const run = (await client.post("/automation-runs", {
      cwd: "D:/project",
      file: "docs/handoff.md",
      reviewers: [{ provider: "glm" }],
      claudeTemplateId: "default-claude-review-full",
      codexTemplateId: "default-codex-edit"
    })) as any;

    await waitFor(async () => ((await client.get(`/automation-runs/${run.id}`)) as any).status === "failed");
    const failed = (await client.get(`/automation-runs/${run.id}`)) as any;
    expect(codexCalled).toBe(false);
    expect(failed.errorJson).toContain("CCAGENT_AUTOMATION_NO_SUCCESSFUL_REVIEWS");
  });

  test("automation retry reruns failed providers before rerunning codex", async () => {
    let deepseekAttempts = 0;
    let codexCalls = 0;
    const daemon = await startDaemon({
      port: 0,
      settings: { workspace: { allowedRoots: ["D:/project"] } },
      orchestration: {
        checkClaudeBinary: fakeCheckClaudeBinary,
        runClaude: async (input) => {
          if (input.prompt.includes("Provider: deepseek")) {
            deepseekAttempts += 1;
            if (deepseekAttempts === 1) {
              throw new CCAgentError(ErrorCodes.ParseError, "first deepseek failure");
            }
          }
          return { content: `review ok ${input.taskId}`, raw: "{}" };
        },
        allocatePort: async () => ({ port: 41010, release: async () => undefined }),
        startProxy: async (config) => ({
          taskId: config.taskId,
          baseUrl: `http://127.0.0.1:${config.port}`,
          stop: async () => undefined
        })
      },
      automationOrchestration: {
        runCodex: async () => {
          codexCalls += 1;
          return { exitCode: 0, content: "Codex output" };
        }
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", createBuiltInProviders().glm);
    await client.post("/providers/glm/secret", { value: "sk-provider" });
    await client.post("/providers", { ...createBuiltInProviders().deepseek, baseUrl: "https://deepseek.example" });
    await client.post("/providers/deepseek/secret", { value: "sk-provider-2" });

    const run = (await client.post("/automation-runs", {
      cwd: "D:/project",
      file: "docs/handoff.md",
      reviewers: [{ provider: "glm" }, { provider: "deepseek" }],
      claudeTemplateId: "default-claude-review-full",
      codexTemplateId: "default-codex-edit"
    })) as any;
    await waitFor(async () => ((await client.get(`/automation-runs/${run.id}`)) as any).status === "done");
    expect(((await client.get(`/automation-runs/${run.id}`)) as any).providers).toEqual([
      expect.objectContaining({ provider: "glm", status: "succeeded" }),
      expect.objectContaining({ provider: "deepseek", status: "failed" })
    ]);

    await client.post(`/automation-runs/${run.id}/retry`);
    await waitFor(async () => {
      const status = (await client.get(`/automation-runs/${run.id}`)) as any;
      return status.status === "done" && status.providers.every((provider: any) => provider.status === "succeeded");
    });

    const retried = (await client.get(`/automation-runs/${run.id}`)) as any;
    expect(deepseekAttempts).toBe(2);
    expect(codexCalls).toBe(4);
    expect(retried.providers).toEqual([
      expect.objectContaining({ provider: "glm", status: "succeeded" }),
      expect.objectContaining({ provider: "deepseek", status: "succeeded" })
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

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}

function extractRunOutputSection(output: string, label: string): string {
  const marker = `# ${label}`;
  const start = output.indexOf(marker);
  if (start === -1) {
    return "";
  }
  const next = output.indexOf("\n# ", start + marker.length);
  return output.slice(start + marker.length, next === -1 ? undefined : next).trim();
}
