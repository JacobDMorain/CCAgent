import { describe, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createMcpServer,
  createDaemonClientFromEnv,
  createMcpTools,
  registerMcpTools,
  syncLocalConfigFromEnv,
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

  test("review_file forwards async mode for long-running reviews", async () => {
    const daemon = new FakeDaemonClient();
    daemon.nextPost = { status: "running", taskId: "task_async" };
    const tools = createMcpTools(daemon);

    await expect(
      tools["ccagent.review_file"].handler({
        provider: "glm",
        cwd: "D:/project",
        file: "large.md",
        mode: "async"
      })
    ).resolves.toMatchObject({ taskId: "task_async" });

    expect(daemon.calls[0]).toMatchObject({
      method: "POST",
      path: "/tasks",
      body: expect.objectContaining({
        files: ["large.md"],
        mode: "async"
      })
    });
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
      "ccagent.review_file_multi",
      "ccagent.get_review_batch_status",
      "ccagent.read_review_batch_output",
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

  test("review_file_multi starts one async review task per reviewer", async () => {
    const daemon = new FakeDaemonClient();
    daemon.nextPost = {
      status: "running",
      batchId: "batch_1",
      tasks: [
        { provider: "glm", model: "glm-5.1", taskId: "task_glm" },
        { provider: "deepseek", model: "deepseek-v4-flash", taskId: "task_deepseek" }
      ]
    };
    const tools = createMcpTools(daemon);

    const result = await tools["ccagent.review_file_multi"].handler({
      cwd: "D:/project",
      file: "test.md",
      reviewStyle: "full",
      reviewers: [
        { provider: "glm", model: "glm-5.1" },
        { provider: "deepseek", model: "deepseek-v4-flash" }
      ]
    });

    expect(result).toMatchObject({
      status: "running",
      batchId: "batch_1",
      tasks: [
        { provider: "glm", model: "glm-5.1", taskId: "task_glm" },
        { provider: "deepseek", model: "deepseek-v4-flash", taskId: "task_deepseek" }
      ]
    });
    expect(daemon.calls).toEqual([
      {
        method: "POST",
        path: "/review-batches",
        body: expect.objectContaining({
          cwd: "D:/project",
          file: "test.md",
          reviewStyle: "full",
          reviewers: [
            { provider: "glm", model: "glm-5.1" },
            { provider: "deepseek", model: "deepseek-v4-flash" }
          ]
        })
      }
    ]);
  });

  test("review batch tools read daemon-persisted state across MCP instances", async () => {
    const daemon = new FakeDaemonClient();
    daemon.nextPost = {
      status: "running",
      batchId: "batch_persisted",
      tasks: [{ provider: "glm", taskId: "task_glm" }]
    };
    const firstTools = createMcpTools(daemon);

    const batch = (await firstTools["ccagent.review_file_multi"].handler({
      cwd: "D:/project",
      file: "test.md",
      reviewers: [{ provider: "glm" }]
    })) as { batchId: string };

    daemon.getResponses.set("/review-batches/batch_persisted", {
      status: "ok",
      batchId: "batch_persisted",
      tasks: [{ provider: "glm", taskId: "task_glm", status: "ok" }]
    });
    daemon.getResponses.set("/review-batches/batch_persisted/output?maxBytes=1000", {
      status: "ok",
      batchId: "batch_persisted",
      reviews: [{ provider: "glm", taskId: "task_glm", status: "ok", content: "GLM review" }],
      summary: "glm: ok (10 chars)"
    });
    const secondTools = createMcpTools(daemon);

    await expect(
      secondTools["ccagent.get_review_batch_status"].handler({ batchId: batch.batchId })
    ).resolves.toMatchObject({ status: "ok", batchId: "batch_persisted" });
    await expect(
      secondTools["ccagent.read_review_batch_output"].handler({
        batchId: batch.batchId,
        maxBytes: 1000
      })
    ).resolves.toMatchObject({
      reviews: [{ provider: "glm", taskId: "task_glm", status: "ok", content: "GLM review" }]
    });
  });

  test("review batch tools aggregate task status and output", async () => {
    const daemon = new FakeDaemonClient();
    daemon.nextPost = { status: "running", batchId: "batch_1" };
    daemon.getResponses.set("/review-batches/batch_1", {
      status: "error",
      batchId: "batch_1",
      tasks: [
        { provider: "glm", taskId: "task_glm", status: "ok" },
        { provider: "deepseek", taskId: "task_deepseek", status: "error" }
      ]
    });
    daemon.getResponses.set("/review-batches/batch_1/output?maxBytes=1000", {
      status: "error",
      batchId: "batch_1",
      reviews: [
        { provider: "glm", taskId: "task_glm", status: "ok", content: "GLM review" },
        {
          provider: "deepseek",
          taskId: "task_deepseek",
          status: "error",
          error: { code: "PROVIDER_ERROR", message: "DeepSeek failed" }
        }
      ],
      summary: "glm: ok (10 chars)\ndeepseek: error"
    });
    const tools = createMcpTools(daemon);

    const batch = (await tools["ccagent.review_file_multi"].handler({
      cwd: "D:/project",
      file: "test.md",
      reviewers: [{ provider: "glm" }, { provider: "deepseek" }]
    })) as { batchId: string };

    await expect(
      tools["ccagent.get_review_batch_status"].handler({ batchId: batch.batchId })
    ).resolves.toMatchObject({
      status: "error",
      tasks: [
        { provider: "glm", taskId: "task_glm", status: "ok" },
        { provider: "deepseek", taskId: "task_deepseek", status: "error" }
      ]
    });

    await expect(
      tools["ccagent.read_review_batch_output"].handler({ batchId: batch.batchId, maxBytes: 1000 })
    ).resolves.toMatchObject({
      status: "error",
      reviews: [
        { provider: "glm", taskId: "task_glm", status: "ok", content: "GLM review" },
        {
          provider: "deepseek",
          taskId: "task_deepseek",
          status: "error",
          error: { code: "PROVIDER_ERROR", message: "DeepSeek failed" }
        }
      ],
      summary: expect.stringContaining("glm: ok")
    });
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

  test("syncLocalConfigFromEnv forwards configured local config path to daemon", async () => {
    const daemon = new FakeDaemonClient();

    await syncLocalConfigFromEnv(daemon, {
      CCAGENT_LOCAL_CONFIG_PATH: "D:/CCAgent/ccagent.local-config.md"
    } as NodeJS.ProcessEnv);

    expect(daemon.calls).toEqual([
      {
        method: "POST",
        path: "/providers/sync-local-config",
        body: { path: "D:/CCAgent/ccagent.local-config.md" }
      }
    ]);
  });

  test("syncLocalConfigFromEnv does not throw when daemon is unavailable during MCP startup", async () => {
    const daemon = new FakeDaemonClient();
    daemon.postError = new Error("connect ECONNREFUSED 127.0.0.1:47621");

    await expect(
      syncLocalConfigFromEnv(daemon, {
        CCAGENT_LOCAL_CONFIG_PATH: "D:/CCAgent/ccagent.local-config.md"
      } as NodeJS.ProcessEnv)
    ).resolves.toBeUndefined();
  });
});

class FakeDaemonClient implements DaemonClientLike {
  calls: Array<{ method: string; path: string; body?: any }> = [];
  nextGet: unknown = {};
  nextPost: unknown = {};
  nextPosts: unknown[] = [];
  getResponses = new Map<string, unknown>();
  postError?: Error;

  async get(path: string): Promise<unknown> {
    this.calls.push({ method: "GET", path });
    if (this.getResponses.has(path)) {
      return this.getResponses.get(path);
    }
    return this.nextGet;
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    this.calls.push({ method: "POST", path, body });
    if (this.postError) {
      throw this.postError;
    }
    if (this.nextPosts.length > 0) {
      return this.nextPosts.shift();
    }
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
