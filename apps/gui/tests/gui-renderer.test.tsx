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

  test("App renders provider, tasks, and workspace root settings surfaces", () => {
    const html = renderToStaticMarkup(
      <App
        initialProviders={[providerFixture]}
        initialTasks={[]}
        initialWorkspaceRoots={["D:/project"]}
      />
    );

    expect(html).toContain("Providers");
    expect(html).toContain("Tasks");
    expect(html).toContain("Workspace roots");
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
