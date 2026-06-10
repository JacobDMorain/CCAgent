import { describe, expect, test } from "vitest";
import type { ProviderConfig, ReviewRole } from "@ccagent/core";
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

  test("runtime settings APIs route through daemon runtime settings endpoint", async () => {
    const daemon = new FakeGuiDaemonClient();
    daemon.nextGet = { claudePath: "claude", codexPath: "codex.cmd", allowedRoots: [] };
    daemon.nextPost = { claudePath: "claude", codexPath: "custom-codex.cmd", allowedRoots: [] };
    const handlers = createGuiApiHandlers(daemon);

    await expect(handlers.getRuntimeSettings()).resolves.toMatchObject({ codexPath: "codex.cmd" });
    await expect(handlers.saveRuntimeSettings({ codexPath: "custom-codex.cmd" })).resolves.toMatchObject({
      codexPath: "custom-codex.cmd"
    });
    await handlers.testCodex();
    expect(daemon.calls).toEqual([
      { method: "GET", path: "/settings/runtime" },
      { method: "POST", path: "/settings/runtime", body: { codexPath: "custom-codex.cmd" } },
      { method: "POST", path: "/settings/codex/test", body: undefined }
    ]);
  });

  test("task APIs route through shared daemon client paths", async () => {
    const daemon = new FakeGuiDaemonClient();
    const handlers = createGuiApiHandlers(daemon);

    await handlers.listTasks();
    await handlers.clearTasks();
    await handlers.cancelTask("task_1");
    await handlers.readTaskOutput("task_1");

    expect(daemon.calls).toEqual([
      { method: "GET", path: "/tasks?limit=100" },
      { method: "DELETE", path: "/tasks" },
      { method: "POST", path: "/tasks/task_1/cancel", body: undefined },
      { method: "GET", path: "/tasks/task_1/output?maxBytes=131072" }
    ]);
  });

  test("provider delete routes through daemon provider endpoint", async () => {
    const daemon = new FakeGuiDaemonClient();
    const handlers = createGuiApiHandlers(daemon);

    await handlers.deleteProvider("glm");

    expect(daemon.calls).toEqual([
      { method: "DELETE", path: "/providers/glm" }
    ]);
  });

  test("automation run APIs route through daemon automation endpoints", async () => {
    const daemon = new FakeGuiDaemonClient();
    const handlers = createGuiApiHandlers(daemon);

    await handlers.createAutomationRun({
      cwd: "D:/project",
      file: "docs/handoff.md",
      reviewers: [{ provider: "glm" }],
      claudeTemplateId: "default-claude-review-full",
      codexTemplateId: "default-codex-edit"
    });
    await handlers.listAutomationRuns();
    await handlers.getAutomationRun("run_1");
    await handlers.readAutomationRunOutput("run_1");
    await handlers.deleteAutomationRun("run_1");
    await handlers.cancelAutomationRun("run_1");
    await handlers.retryAutomationRun("run_1");
    await handlers.rerunCodexEdit("run_1");

    expect(daemon.calls).toEqual([
      {
        method: "POST",
        path: "/automation-runs",
        body: {
          cwd: "D:/project",
          file: "docs/handoff.md",
          reviewers: [{ provider: "glm" }],
          claudeTemplateId: "default-claude-review-full",
          codexTemplateId: "default-codex-edit"
        }
      },
      { method: "GET", path: "/automation-runs?limit=100" },
      { method: "GET", path: "/automation-runs/run_1" },
      { method: "GET", path: "/automation-runs/run_1/output?maxBytes=131072" },
      { method: "DELETE", path: "/automation-runs/run_1" },
      { method: "POST", path: "/automation-runs/run_1/cancel", body: undefined },
      { method: "POST", path: "/automation-runs/run_1/retry", body: undefined },
      { method: "POST", path: "/automation-runs/run_1/rerun-codex", body: undefined }
    ]);
  });

  test("prompt template APIs route through daemon template endpoints", async () => {
    const daemon = new FakeGuiDaemonClient();
    const handlers = createGuiApiHandlers(daemon);

    await handlers.listPromptTemplates();
    await handlers.savePromptTemplate({
      id: "template-1",
      kind: "codex-edit",
      name: "Codex",
      description: "Codex",
      version: 1,
      content: "Read {reviewPacket}",
      requiredVariables: ["reviewPacket"],
      isDefault: false,
      createdAt: "2026-06-08T10:00:00.000Z",
      updatedAt: "2026-06-08T10:00:00.000Z"
    });
    await handlers.deletePromptTemplate("template-1");

    expect(daemon.calls).toEqual([
      { method: "GET", path: "/prompt-templates" },
      {
        method: "POST",
        path: "/prompt-templates",
        body: expect.objectContaining({ id: "template-1", kind: "codex-edit" })
      },
      { method: "DELETE", path: "/prompt-templates/template-1" }
    ]);
  });

  test("review role APIs route through daemon role endpoints", async () => {
    const daemon = new FakeGuiDaemonClient();
    daemon.nextGet = [roleFixture];
    daemon.nextPost = roleFixture;
    const handlers = createGuiApiHandlers(daemon);

    await handlers.listReviewRoles();
    await handlers.saveReviewRole(roleFixture);
    await handlers.generateReviewRoles({ cwd: "D:/project", file: "docs/handoff.md", language: "中文" });
    await handlers.promoteReviewRole({ ...roleFixture, source: "generated" });
    await handlers.deleteReviewRole("document-structure");

    expect(daemon.calls).toEqual([
      { method: "GET", path: "/review-roles" },
      { method: "POST", path: "/review-roles", body: roleFixture },
      {
        method: "POST",
        path: "/review-roles/generate",
        body: { cwd: "D:/project", file: "docs/handoff.md", language: "中文" }
      },
      {
        method: "POST",
        path: "/review-roles/promote",
        body: { role: { ...roleFixture, source: "generated" } }
      },
      { method: "DELETE", path: "/review-roles/document-structure" }
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

const roleFixture: ReviewRole = {
  id: "document-structure",
  name: "文档结构审查员",
  description: "检查章节结构。",
  prompt: "你负责检查章节结构。",
  focusAreas: ["章节结构"],
  outputInstructions: "按角色分段输出。",
  defaultSelected: true,
  source: "global",
  createdAt: "2026-06-10T10:00:00.000Z",
  updatedAt: "2026-06-10T10:00:00.000Z"
};
