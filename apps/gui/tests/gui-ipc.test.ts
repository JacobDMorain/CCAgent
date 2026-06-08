import { describe, expect, test } from "vitest";
import type { ProviderConfig } from "@ccagent/core";
import { createGuiApiHandlers, type GuiDaemonClientLike } from "../src/main/ipcHandlers.js";

describe("GUI IPC handlers", () => {
  test("provider save validates fields and stores secret without returning api key", async () => {
    const daemon = new FakeGuiDaemonClient();
    daemon.nextPost = providerFixture;
    const handlers = createGuiApiHandlers(daemon);

    const result = await handlers.saveProvider(providerFixture, "sk-real-secret");

    expect(result).toMatchObject({ id: "glm" });
    expect(JSON.stringify(result)).not.toContain("sk-real-secret");
    expect(daemon.calls).toEqual([
      { method: "POST", path: "/providers", body: providerFixture },
      { method: "POST", path: "/providers/glm/secret", body: { value: "sk-real-secret" } }
    ]);
  });

  test("workspace roots are configured through daemon settings endpoint", async () => {
    const daemon = new FakeGuiDaemonClient();
    daemon.nextPost = { allowedRoots: ["D:/project"] };
    const handlers = createGuiApiHandlers(daemon);

    await expect(handlers.setWorkspaceRoots(["D:/project"])).resolves.toEqual({
      allowedRoots: ["D:/project"]
    });
    expect(daemon.calls[0]).toEqual({
      method: "POST",
      path: "/settings/workspace-roots",
      body: { allowedRoots: ["D:/project"] }
    });
  });

  test("task APIs route through shared daemon client paths", async () => {
    const daemon = new FakeGuiDaemonClient();
    const handlers = createGuiApiHandlers(daemon);

    await handlers.listTasks();
    await handlers.cancelTask("task_1");
    await handlers.readTaskOutput("task_1");

    expect(daemon.calls).toEqual([
      { method: "GET", path: "/tasks?limit=100" },
      { method: "POST", path: "/tasks/task_1/cancel", body: undefined },
      { method: "GET", path: "/tasks/task_1/output?maxBytes=131072" }
    ]);
  });
});

class FakeGuiDaemonClient implements GuiDaemonClientLike {
  calls: Array<{ method: string; path: string; body?: unknown }> = [];
  nextGet: unknown = [];
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

const providerFixture: ProviderConfig = {
  id: "glm",
  displayName: "Zhipu GLM",
  mode: "openai-compatible",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKeyRef: "providers/glm/api-key",
  auth: {
    header: "Authorization",
    scheme: "Bearer"
  },
  models: {
    default: "glm-5.1",
    review: "glm-5.1"
  },
  capabilities: {
    streaming: true,
    tools: false,
    systemPrompt: true
  },
  enabled: true,
  createdAt: "2026-06-05T10:00:00.000Z",
  updatedAt: "2026-06-05T10:00:00.000Z"
};
