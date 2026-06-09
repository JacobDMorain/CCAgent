import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ProviderConfig } from "@ccagent/core";
import { App } from "../src/renderer/App.js";
import { ProviderForm } from "../src/renderer/components/ProviderForm.js";
import { TaskTable } from "../src/renderer/components/TaskTable.js";

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

  test("App renders provider, template, task, and runtime settings surfaces", () => {
    const html = renderToStaticMarkup(
      <App
        initialProviders={[providerFixture]}
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
            ]
          }
        ]}
        initialWorkspaceRoots={["D:/project"]}
      />
    );

    expect(html).toContain("Review Workspace");
    expect(html).toContain("Providers");
    expect(html).toContain("New provider");
    expect(html).toContain("Delete provider");
    expect(html).toContain("Prompt Templates");
    expect(html).toContain("Runs");
    expect(html).toContain("Start fully automatic run");
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
