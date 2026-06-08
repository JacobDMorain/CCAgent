import { afterEach, describe, expect, test } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CCAgentError, ErrorCodes } from "@ccagent/core";
import { createBuiltInProviders } from "@ccagent/provider";
import { DaemonClient } from "@ccagent/daemon-client";
import { createDatabase, SqliteTaskStore } from "@ccagent/storage";
import { MemorySecretStore } from "@ccagent/secrets";
import { createDaemon } from "../../apps/daemon/src/index.js";

const daemons: Array<{ stop(): Promise<void> }> = [];

describe("concurrent provider E2E", () => {
  afterEach(async () => {
    await Promise.all(daemons.splice(0).map((daemon) => daemon.stop()));
  });

  test("two concurrent tasks use different proxy ports and cancelling one does not cancel the other", async () => {
    const allocatedPorts: number[] = [];
    const stoppedProxies: string[] = [];
    let nextPort = 43000;
    let slowTaskId = "";

    const daemon = await createDaemon({
      ...isolatedDaemonOptions(),
      port: 0,
      settings: {
        workspace: { allowedRoots: ["D:/project"] },
        tasks: { maxConcurrentTasks: 2 },
        claude: { path: "fake-claude" }
      },
      secretStore: new MemorySecretStore(),
      orchestration: {
        allocatePort: async () => {
          const port = nextPort++;
          allocatedPorts.push(port);
          return { port, release: async () => undefined };
        },
        startProxy: async (config) => ({
          taskId: config.taskId,
          baseUrl: `http://127.0.0.1:${config.port}`,
          stop: async () => {
            stoppedProxies.push(config.taskId);
          }
        }),
        runClaude: async (input) => {
          if (input.prompt.includes("slow")) {
            slowTaskId = input.taskId;
            await new Promise((_resolve, reject) => {
              input.signal?.addEventListener(
                "abort",
                () => reject(new CCAgentError(ErrorCodes.Cancelled, "cancelled")),
                { once: true }
              );
            });
          }
          input.onStdout(`completed ${input.taskId}`);
          return { content: `result ${input.taskId}`, raw: "{}" };
        },
        checkClaudeBinary: async () => "claude 1.0.0"
      }
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    const builtIns = createBuiltInProviders();
    await client.post("/providers", builtIns.glm);
    await client.post("/providers/glm/secret", { value: "sk-glm" });
    await client.post("/providers", builtIns.deepseek);
    await client.post("/providers/deepseek/secret", { value: "sk-deepseek" });

    const slow = client.post("/tasks", {
      provider: "glm",
      cwd: "D:/project",
      prompt: "slow task"
    }) as Promise<any>;
    await waitFor(() => slowTaskId !== "");
    await waitFor(() => allocatedPorts.length === 1);
    const fast = (await client.post("/tasks", {
      provider: "deepseek",
      cwd: "D:/project",
      prompt: "fast task"
    })) as any;

    try {
      expect(fast.status).toBe("ok");
      expect(new Set(allocatedPorts).size).toBe(2);
    } finally {
      await client.post(`/tasks/${slowTaskId}/cancel`).catch(() => undefined);
    }
    await expect(slow).resolves.toMatchObject({ status: "cancelled" });
    await expect(client.get(`/tasks/${fast.taskId}`)).resolves.toMatchObject({ status: "ok" });
    await expect(client.get(`/tasks/${fast.taskId}/logs?maxBytes=1000`)).resolves.toMatchObject({
      content: expect.stringContaining("stdout: completed")
    });
    expect(stoppedProxies).toEqual(expect.arrayContaining([slowTaskId, fast.taskId]));
  });

  test("startup recovery marks persisted running tasks as error", async () => {
    const database = createDatabase(":memory:");
    const taskStore = new SqliteTaskStore(database);
    taskStore.createTask({
      id: "task_recover_e2e",
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      prompt: "Review",
      startedAt: "2026-06-05T10:00:00.000Z"
    });
    taskStore.updateTask("task_recover_e2e", { status: "running" });

    const daemon = await createDaemon({
      ...isolatedDaemonOptions(),
      port: 0,
      taskStore,
      secretStore: new MemorySecretStore()
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });

    await expect(client.get("/tasks/task_recover_e2e")).resolves.toMatchObject({
      status: "error",
      errorJson: expect.stringContaining(ErrorCodes.DaemonRecovered)
    });
  });

  test("missing Claude binary preflight reports a clear startup error", async () => {
    const daemon = await createDaemon({
      ...isolatedDaemonOptions(),
      port: 0,
      settings: {
        workspace: { allowedRoots: ["D:/project"] },
        claude: { path: "Z:/missing/claude.exe" }
      },
      secretStore: new MemorySecretStore()
    });
    daemons.push(daemon);
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    await client.post("/providers", {
      ...createBuiltInProviders().glm,
      mode: "anthropic-compatible" as const,
      baseUrl: "https://anthropic.fake/v1"
    });
    await client.post("/providers/glm/secret", { value: "sk-glm" });

    await expect(
      client.post("/tasks", {
        provider: "glm",
        cwd: "D:/project",
        prompt: "will fail"
      })
    ).resolves.toMatchObject({
      status: "error",
      error: { code: ErrorCodes.ClaudeNotFound }
    });
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function isolatedDaemonOptions() {
  return {
    configPath: join(tmpdir(), `ccagent-e2e-config-${Date.now()}-${Math.random()}.json`),
    databasePath: ":memory:"
  };
}
