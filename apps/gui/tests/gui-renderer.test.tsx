import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AutomationRunRequest, ProviderConfig, ReviewRole } from "@ccagent/core";
import { App } from "../src/renderer/App.js";
import { ProviderForm } from "../src/renderer/components/ProviderForm.js";
import { TaskTable } from "../src/renderer/components/TaskTable.js";
import { ReviewRolesPage } from "../src/renderer/routes/ReviewRolesPage.js";
import { ReviewWorkspacePage } from "../src/renderer/routes/ReviewWorkspacePage.js";
import { RunsPage } from "../src/renderer/routes/RunsPage.js";
import { createTranslator } from "../src/renderer/i18n.js";

describe("GUI renderer", () => {
  test("ProviderForm renders all required provider fields without exposing saved key", () => {
    const html = renderToStaticMarkup(
      <ProviderForm provider={providerFixture} secretFingerprint="sk-...abcd" />
    );

    for (const label of [
      "Provider id",
      "Display name",
      "Mode",
      "Base URL",
      "Auth header",
      "Auth scheme",
      "Default model",
      "Review model",
      "Streaming",
      "Tools",
      "Enabled",
      "API key",
      "Save",
      "Test"
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("sk-...abcd");
    expect(html).not.toContain("sk-real-secret");
  });

  test("TaskTable renders required columns and structured error message", () => {
    const html = renderToStaticMarkup(
      <TaskTable
        tasks={[
          {
            id: "task_1",
            status: "error",
            provider: "glm",
            model: "glm-5.1",
            cwd: "D:/project",
            prompt: "Review",
            startedAt: "2026-06-05T10:00:00.000Z",
            errorJson: JSON.stringify({ code: "CCAGENT_PARSE_ERROR", message: "bad output" })
          }
        ]}
      />
    );

    for (const heading of [
      "Task id",
      "Status",
      "Provider",
      "Model",
      "CWD",
      "Started",
      "Duration",
      "Output preview",
      "Cancel",
      "Output"
    ]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("bad output");
  });

  test("RunsPage renders status iteration tabs and selected iteration content", () => {
    const html = renderToStaticMarkup(
      <RunsPage
        t={createTranslator("en")}
        runs={[runFixture]}
        selectedStatusRunId="run_1"
        selectedStatus={{
          overview: "## Iterations\n- Iteration 1\n- Iteration 2",
          iterations: [
            { iteration: 1, label: "Iteration 1", content: "first iteration summary" },
            { iteration: 2, label: "Iteration 2", content: "second iteration summary" }
          ],
          selectedIteration: 2
        }}
        onCancel={() => undefined}
        onShowStatus={() => undefined}
        onSelectStatusIteration={() => undefined}
        onReadOutput={() => undefined}
        onDelete={() => undefined}
      />
    );

    expect(html).toContain("Overview");
    expect(html).toContain("Iteration 1");
    expect(html).toContain("Iteration 2");
    expect(html).toContain("second iteration summary");
    expect(html).not.toContain("first iteration summary");
  });

  test("RunsPage renders CLI status, elapsed time, and terminate action for active runs", () => {
    const html = renderToStaticMarkup(
      <RunsPage
        t={createTranslator("en")}
        nowMs={Date.parse("2026-06-08T10:01:05.000Z")}
        runs={[{
          ...runFixture,
          status: "reviewing",
          providers: [
            {
              runId: "run_1",
              provider: "glm",
              status: "running",
              startedAt: "2026-06-08T10:00:00.000Z",
              position: 0
            },
            {
              runId: "run_1",
              provider: "deepseek",
              status: "succeeded",
              position: 1
            }
          ]
        }]}
        onCancel={() => undefined}
        onShowStatus={() => undefined}
        onSelectStatusIteration={() => undefined}
        onReadOutput={() => undefined}
        onDelete={() => undefined}
      />
    );

    expect(html).toContain("CLI");
    expect(html).toContain("Elapsed");
    expect(html).toContain("Claude CLI: glm:running, deepseek:succeeded");
    expect(html).toContain("Terminate CLI");
    expect(html).toContain("1:05");
    expect(html).not.toContain("disabled");
  });

  test("App renders provider, template, task, and runtime settings surfaces", () => {
    const html = renderToStaticMarkup(
      <App
        initialProviders={[providerFixture]}
        initialReviewRoles={[roleFixture]}
        initialTasks={[]}
        initialTemplates={[
          {
            id: "default-claude-review-full",
            kind: "claude-review",
            name: "Full Claude Review",
            description: "Review",
            version: 1,
            content: "Review {file}",
            requiredVariables: ["file"],
            isDefault: true,
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T10:00:00.000Z"
          },
          {
            id: "default-codex-edit",
            kind: "codex-edit",
            name: "Codex Edit From Review Packet",
            description: "Edit",
            version: 1,
            content: "Read {reviewPacket}",
            requiredVariables: ["reviewPacket"],
            isDefault: true,
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T10:00:00.000Z"
          }
        ]}
        initialRuns={[
          {
            id: "run_1",
            status: "done",
            cwd: "D:/project",
            file: "D:/project/docs/handoff.md",
            reviewStyle: "full",
            claudeTemplateId: "default-claude-review-full",
            codexTemplateId: "default-codex-edit",
            fullyAuto: true,
            maxIterations: 3,
            outputDir: "D:/project/.ccagent/runs/run_1",
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T10:00:01.000Z",
            finishedAt: "2026-06-08T10:00:01.000Z",
            providers: [
              {
                runId: "run_1",
                provider: "glm",
                status: "succeeded",
                position: 0
              }
            ],
            iterations: [
              {
                runId: "run_1",
                iteration: 1,
                status: "stopped",
                changesDetected: false,
                stopReason: "no remaining actionable changes",
                startedAt: "2026-06-08T10:00:00.000Z",
                finishedAt: "2026-06-08T10:00:01.000Z"
              }
            ]
          }
        ]}
        initialWorkspaceRoots={["D:/project"]}
      />
    );

    expect(html).toContain("Review Workspace");
    expect(html).toContain("Review Roles");
    expect(html).toContain("Providers");
    expect(html).toContain("New provider");
    expect(html).toContain("Delete provider");
    expect(html).toContain("Prompt Templates");
    expect(html).toContain("Runs");
    expect(html).toContain("Start fully automatic run");
    expect(html).toContain("Global Roles");
    expect(html).toContain("Generate roles from document");
    expect(html).toContain("文档结构审查员");
    expect(html).toContain("Max iterations");
    expect(html).toContain("Iterations");
    expect(html).toContain("1 / 3 stopped");
    expect(html).toContain("Full Claude Review");
    expect(html).toContain("run_1");
    expect(html).toContain("Tasks");
    expect(html).toContain("Showing the 3 most recent tasks");
    expect(html).toContain("Expand");
    expect(html).toContain("Clear history");
    expect(html).toContain("Claude Code CLI path");
    expect(html).toContain("Codex CLI path");
    expect(html).toContain("Test Codex");
    expect(html).toContain("Ready");
    expect(html).not.toContain("Workspace roots");
    expect(html).toContain("D:/project");
  });

  test("App renders Chinese labels when Chinese locale is selected", () => {
    const html = renderToStaticMarkup(
      <App
        initialLocale="zh"
        initialProviders={[providerFixture]}
        initialReviewRoles={[roleFixture]}
        initialTasks={[]}
        initialTemplates={[
          {
            id: "default-claude-review-full",
            kind: "claude-review",
            name: "Full Claude Review",
            description: "Review",
            version: 1,
            content: "Review {file}",
            requiredVariables: ["file"],
            isDefault: true,
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T10:00:00.000Z"
          },
          {
            id: "default-codex-edit",
            kind: "codex-edit",
            name: "Codex Edit From Review Packet",
            description: "Edit",
            version: 1,
            content: "Read {reviewPacket}",
            requiredVariables: ["reviewPacket"],
            isDefault: true,
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T10:00:00.000Z"
          },
          {
            id: "default-claude-review-full-zh",
            kind: "claude-review",
            name: "完整 Claude 评审",
            description: "评审",
            version: 1,
            content: "评审 {file}",
            requiredVariables: ["file"],
            isDefault: true,
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T10:00:00.000Z"
          },
          {
            id: "default-codex-edit-zh",
            kind: "codex-edit",
            name: "Codex 根据评审包修改文档",
            description: "修改",
            version: 1,
            content: "读取 {reviewPacket}",
            requiredVariables: ["reviewPacket"],
            isDefault: true,
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T10:00:00.000Z"
          }
        ]}
      />
    );

    expect(html).toContain("评审工作区");
    expect(html).toContain("评审角色");
    expect(html).toContain("服务商");
    expect(html).toContain("提示词模板");
    expect(html).toContain("启动全自动流程");
    expect(html).toContain("全局角色");
    expect(html).toContain("最大迭代轮次");
    expect(html).toContain("Claude Code CLI 路径");
    expect(html).toContain("就绪");
    expect(html).toContain("完整 Claude 评审");
    expect(html).toContain("Codex 根据评审包修改文档");
    expect(html).not.toContain("Full Claude Review");
    expect(html).not.toContain("Codex Edit From Review Packet");
  });

  test("ReviewWorkspacePage submits selected role snapshot and role ids per provider", async () => {
    let submitted: AutomationRunRequest | undefined;
    const html = renderToStaticMarkup(
      <ReviewWorkspacePage
        locale="en"
        t={createTranslator("en")}
        providers={[providerFixture]}
        templates={[
          {
            id: "default-claude-review-full",
            kind: "claude-review",
            name: "Full Claude Review",
            description: "Review",
            version: 1,
            content: "Review {file}",
            requiredVariables: ["file"],
            isDefault: true,
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T10:00:00.000Z"
          },
          {
            id: "default-codex-edit",
            kind: "codex-edit",
            name: "Codex Edit From Review Packet",
            description: "Edit",
            version: 1,
            content: "Read {reviewPacket}",
            requiredVariables: ["reviewPacket"],
            isDefault: true,
            createdAt: "2026-06-08T10:00:00.000Z",
            updatedAt: "2026-06-08T10:00:00.000Z"
          }
        ]}
        globalRoles={[roleFixture]}
        generatedRoles={[generatedRoleFixture]}
        onStart={(request) => {
          submitted = request;
        }}
      />
    );

    expect(html).toContain("Global Roles");
    expect(html).toContain("Generated Roles");
    expect(html).toContain("Documentation Quality");
    expect(html).toContain("Core Technology");
    expect(html).toContain("文档结构审查员");
    expect(html).toContain("算法一致性审查员");

    const fakeForm = new Map<string, FormDataEntryValue>([
      ["cwd", "D:/project"],
      ["file", "docs/handoff.md"],
      ["claudeTemplateId", "default-claude-review-full"],
      ["codexTemplateId", "default-codex-edit"],
      ["reviewStyle", "full"],
      ["language", "English"],
      ["maxIterations", "3"],
      ["provider:glm", "on"],
      ["role:document-structure", "on"],
      ["role:algorithm-consistency", "on"]
    ]);
    const request = ReviewWorkspacePage.buildRequestFromForm(fakeForm, {
      providers: [providerFixture],
      roles: [roleFixture, generatedRoleFixture]
    });
    submitted = request;

    expect(submitted.reviewers).toEqual([
      { provider: "glm", roleIds: ["document-structure", "algorithm-consistency"] }
    ]);
    expect(submitted.roles?.map((role) => role.id)).toEqual(["document-structure", "algorithm-consistency"]);
  });

  test("ReviewRolesPage groups roles by functional area and edits role group", () => {
    const html = renderToStaticMarkup(
      <ReviewRolesPage
        t={createTranslator("en")}
        roles={[roleFixture, generatedRoleFixture]}
        onSave={() => undefined}
        onDelete={() => undefined}
      />
    );

    expect(html).toContain("Documentation Quality");
    expect(html).toContain("Core Technology");
    expect(html).toContain("1 role");
    expect(html).toContain("Group");
    expect(html).toContain('name="group"');
    expect(html).toContain('type="radio"');
    expect(html).toContain('value="documentation-quality"');
    expect(html).toContain("Custom group");
    expect(html).toContain('name="customGroup"');
    expect(html).not.toContain('list="review-role-groups"');
    expect(html).not.toContain("Role prompt");
    expect(html).not.toContain("Output instructions");
  });
});

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

const runFixture = {
  id: "run_1",
  status: "done" as const,
  cwd: "D:/project",
  file: "D:/project/docs/handoff.md",
  reviewStyle: "full" as const,
  claudeTemplateId: "default-claude-review-full",
  codexTemplateId: "default-codex-edit",
  fullyAuto: true,
  maxIterations: 3,
  outputDir: "D:/project/.ccagent/runs/run_1",
  createdAt: "2026-06-08T10:00:00.000Z",
  updatedAt: "2026-06-08T10:00:01.000Z",
  providers: [],
  iterations: []
};

const roleFixture: ReviewRole = {
  id: "document-structure",
  group: "documentation-quality",
  name: "文档结构审查员",
  description: "检查章节结构。",
  focusAreas: ["章节结构"],
  defaultSelected: true,
  source: "global",
  createdAt: "2026-06-10T10:00:00.000Z",
  updatedAt: "2026-06-10T10:00:00.000Z"
};

const generatedRoleFixture: ReviewRole = {
  id: "algorithm-consistency",
  group: "core-technology",
  name: "算法一致性审查员",
  description: "检查算法描述和上下文一致性。",
  focusAreas: ["公式", "伪代码"],
  defaultSelected: true,
  source: "generated",
  createdAt: "2026-06-10T10:00:00.000Z",
  updatedAt: "2026-06-10T10:00:00.000Z"
};
