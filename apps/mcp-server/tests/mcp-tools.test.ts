import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createMcpServer,
  createDaemonClientFromEnv,
  createMcpTools,
  registerMcpTools,
  toMcpToolResult,
  type DaemonClientLike
} from "../src/index.js";

describe("MCP tools", () => {
  test("list_providers forwards to daemon", async () => {
    const daemon = new FakeDaemonClient();
    daemon.nextGet = [{ id: "glm" }];
    const tools = createMcpTools(daemon);

    await expect(tools["ccagent.list_providers"].handler({})).resolves.toEqual([{ id: "glm" }]);
    expect(daemon.calls[0]).toEqual({ method: "GET", path: "/providers" });
  });

  test("test_provider forwards provider test payload", async () => {
    const daemon = new FakeDaemonClient();
    daemon.nextPost = { status: "ok" };
    const tools = createMcpTools(daemon);

    await expect(
      tools["ccagent.test_provider"].handler({ provider: "glm", model: "glm-5.1" })
    ).resolves.toEqual({ status: "ok" });
    expect(daemon.calls[0]).toEqual({
      method: "POST",
      path: "/providers/test",
      body: { provider: "glm", model: "glm-5.1" }
    });
  });

  test("run_task validates input and forwards to daemon tasks endpoint", async () => {
    const daemon = new FakeDaemonClient();
    daemon.nextPost = { status: "ok", taskId: "task_1" };
    const tools = createMcpTools(daemon);

    await expect(
      tools["ccagent.run_task"].handler({
        provider: "glm",
        cwd: "D:/project",
        prompt: "Review test.md"
      })
    ).resolves.toMatchObject({ status: "ok" });
    expect(daemon.calls[0]).toMatchObject({ method: "POST", path: "/tasks" });
  });

  test("run_task rejects invalid provider id", async () => {
    const tools = createMcpTools(new FakeDaemonClient());

    await expect(
      tools["ccagent.run_task"].handler({
        provider: "../bad",
        cwd: "D:/project",
        prompt: "Review test.md"
      })
    ).rejects.toThrow();
  });

  test("review_file builds review prompt before daemon task call", async () => {
    const daemon = new FakeDaemonClient();
    daemon.nextPost = { status: "ok", taskId: "task_1" };
    const tools = createMcpTools(daemon);

    await tools["ccagent.review_file"].handler({
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      file: "test.md",
      reviewStyle: "bugs",
      language: "en-US"
    });

    expect(daemon.calls[0].path).toBe("/tasks");
    expect(daemon.calls[0].body.prompt).toContain("Review the file: test.md");
    expect(daemon.calls[0].body.prompt).toContain("Return the result in en-US.");
  });

  test("status/output/cancel tools map to daemon endpoints", async () => {
    const daemon = new FakeDaemonClient();
    const tools = createMcpTools(daemon);

    await tools["ccagent.get_task_status"].handler({ taskId: "task_1" });
    await tools["ccagent.read_task_output"].handler({ taskId: "task_1", maxBytes: 10 });
    await tools["ccagent.cancel_task"].handler({ taskId: "task_1" });

    expect(daemon.calls).toEqual([
      { method: "GET", path: "/tasks/task_1" },
      { method: "GET", path: "/tasks/task_1/output?maxBytes=10" },
      { method: "POST", path: "/tasks/task_1/cancel", body: undefined }
    ]);
  });

  test("registerMcpTools registers each tool with SDK-compatible result envelope", async () => {
    const daemon = new FakeDaemonClient();
    daemon.nextGet = [{ id: "glm" }];
    const tools = createMcpTools(daemon);
    const server = new FakeMcpServer();

    registerMcpTools(server as any, tools);

    expect(server.registered.map((tool) => tool.name)).toEqual([
      "ccagent.list_providers",
      "ccagent.test_provider",
      "ccagent.run_task",
      "ccagent.review_file",
      "ccagent.get_task_status",
      "ccagent.read_task_output",
      "ccagent.cancel_task"
    ]);
    const result = await server.registered[0].handler({});
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify([{ id: "glm" }], null, 2) }],
      structuredContent: { result: [{ id: "glm" }] }
    });
  });

  test("createMcpServer returns an SDK server with registered tools", () => {
    const server = createMcpServer(new FakeDaemonClient());

    expect(server).toBeTruthy();
    expect(server.isConnected()).toBe(false);
  });

  test("toMcpToolResult preserves object structured content", () => {
    expect(toMcpToolResult({ status: "ok" })).toEqual({
      content: [{ type: "text", text: "{\n  \"status\": \"ok\"\n}" }],
      structuredContent: { status: "ok" }
    });
  });

  test("createDaemonClientFromEnv uses explicit daemon URL and token", async () => {
    const client = createDaemonClientFromEnv({
      CCAGENT_DAEMON_URL: "http://127.0.0.1:9",
      CCAGENT_DAEMON_TOKEN: "token-from-env"
    } as NodeJS.ProcessEnv);

    expect(client).toBeTruthy();
  });

  test("createDaemonClientFromEnv does not create config during MCP startup", async () => {
    const configPath = join(tmpdir(), `ccagent-mcp-missing-config-${Date.now()}.json`);

    const client = createDaemonClientFromEnv({
      CCAGENT_CONFIG_PATH: configPath
    } as NodeJS.ProcessEnv);

    expect(client).toBeTruthy();
    expect(existsSync(configPath)).toBe(false);
  });
});

class FakeDaemonClient implements DaemonClientLike {
  calls: Array<{ method: string; path: string; body?: any }> = [];
  nextGet: unknown = {};
  nextPost: unknown = {};

  async get(path: string): Promise<unknown> {
    this.calls.push({ method: "GET", path });
    return this.nextGet;
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    this.calls.push({ method: "POST", path, body });
    return this.nextPost;
  }

  async delete(path: string): Promise<unknown> {
    this.calls.push({ method: "DELETE", path });
    return {};
  }
}

class FakeMcpServer {
  registered: Array<{
    name: string;
    config: any;
    handler: (input: unknown) => Promise<unknown>;
  }> = [];

  registerTool(name: string, config: any, handler: (input: unknown) => Promise<unknown>): void {
    this.registered.push({ name, config, handler });
  }
}
