import { describe, expect, test } from "vitest";
import type { ProviderConfig } from "@ccagent/core";
import {
  buildProviderFromForm,
  formatOutput,
  formatRunDecisionSummary,
  parseErrorMessage,
  toRuntimeError,
  upsertProvider
} from "../src/renderer/guiLogic.js";

describe("GUI renderer logic", () => {
  test("buildProviderFromForm creates provider config and separates API key", () => {
    const form = new FormData();
    form.set("id", "glm");
    form.set("displayName", "Zhipu GLM");
    form.set("mode", "openai-compatible");
    form.set("baseUrl", "https://open.bigmodel.cn/api/paas/v4");
    form.set("authHeader", "Authorization");
    form.set("authScheme", "Bearer");
    form.set("defaultModel", "glm-5.1");
    form.set("reviewModel", "glm-5.1");
    form.set("apiKey", "sk-real-secret");
    form.set("streaming", "on");
    form.set("enabled", "on");

    const result = buildProviderFromForm(form, emptyProvider, "2026-06-05T10:00:00.000Z");

    expect(result.apiKey).toBe("sk-real-secret");
    expect(result.provider).toMatchObject({
      id: "glm",
      displayName: "Zhipu GLM",
      apiKeyRef: "ccagent/providers/glm/api-key",
      models: { default: "glm-5.1", review: "glm-5.1" },
      capabilities: { streaming: true, tools: false, systemPrompt: true },
      enabled: true
    });
  });

  test("buildProviderFromForm omits optional API key and review model when blank", () => {
    const form = new FormData();
    form.set("id", "custom");
    form.set("displayName", "Custom");
    form.set("mode", "anthropic-compatible");
    form.set("baseUrl", "https://anthropic.example/v1");
    form.set("authHeader", "x-api-key");
    form.set("authScheme", "Raw");
    form.set("defaultModel", "claude-compatible");
    form.set("reviewModel", " ");
    form.set("apiKey", " ");

    const result = buildProviderFromForm(form, {
      ...emptyProvider,
      apiKeyRef: "existing/ref",
      createdAt: "2026-01-01T00:00:00.000Z"
    });

    expect(result.apiKey).toBeUndefined();
    expect(result.provider.apiKeyRef).toBe("existing/ref");
    expect(result.provider.models.review).toBeUndefined();
    expect(result.provider.capabilities.streaming).toBe(false);
    expect(result.provider.enabled).toBe(false);
  });

  test("upsertProvider inserts and replaces by provider id", () => {
    expect(upsertProvider([], providerFixture)).toEqual([providerFixture]);
    expect(
      upsertProvider([providerFixture], { ...providerFixture, displayName: "Updated" })
    ).toEqual([{ ...providerFixture, displayName: "Updated" }]);
  });

  test("formatOutput and parseErrorMessage produce GUI-safe text", () => {
    expect(formatOutput({ content: "review result" })).toBe("review result");
    expect(formatOutput("raw output")).toBe("raw output");
    expect(formatOutput({ content: 42, truncated: false })).toContain('"truncated": false');
    expect(parseErrorMessage()).toBe("");
    expect(parseErrorMessage(JSON.stringify({ code: "CCAGENT_PARSE_ERROR", message: "bad output" }))).toBe(
      "CCAGENT_PARSE_ERROR: bad output"
    );
    expect(parseErrorMessage("raw error")).toBe("raw error");
  });

  test("formatRunDecisionSummary shows only Codex adjudication from run output", () => {
    const summary = formatRunDecisionSummary(
      runFixture,
      [
        "# review-packet.md",
        "",
        "provider details",
        "",
        "# codex-decision-summary.md",
        "",
        "## Applied",
        "- Updated section 4.",
        "",
        "## Rejected",
        "- Rename file suggestion.",
        "",
        "# codex-output.md",
        "",
        "Applied: update section 4.",
        "Rejected: rename file suggestion.",
        "",
        "# codex-stdout.log",
        "",
        "debug log"
      ].join("\n")
    );

    expect(summary).toBe([
      "Codex review decision for D:/project/docs/handoff.md:",
      "",
      "## Applied",
      "- Updated section 4.",
      "",
      "## Rejected",
      "- Rename file suggestion."
    ].join("\n"));
    expect(summary).not.toContain("provider details");
    expect(summary).not.toContain("debug log");
    expect(summary).not.toContain("Applied: update section 4.");
  });

  test("formatRunDecisionSummary prefers iterative final report over raw iteration logs", () => {
    const summary = formatRunDecisionSummary(
      {
        ...runFixture,
        maxIterations: 3,
        iterations: [
          {
            runId: "run_1",
            iteration: 1,
            status: "completed",
            changesDetected: true,
            continueRequested: true,
            startedAt: "2026-06-08T10:00:00.000Z"
          },
          {
            runId: "run_1",
            iteration: 2,
            status: "stopped",
            changesDetected: false,
            continueRequested: false,
            stopReason: "no remaining actionable changes",
            startedAt: "2026-06-08T10:01:00.000Z"
          }
        ]
      },
      [
        "# final-report.md",
        "",
        "## Iterations",
        "- Iteration 1: completed; continue=yes; codex_continue=yes; confidence=medium; next_focus=Check title wording; risk_flags=changed-target-document",
        "- Iteration 2: stopped; continue=no; codex_continue=yes; confidence=high; reason=max iteration limit",
        "",
        "# iteration-001/codex-decision-summary.md",
        "",
        "old first iteration summary",
        "",
        "# iteration-002/codex-decision-summary.md",
        "",
        "latest iteration summary"
      ].join("\n")
    );

    expect(summary).toContain("## Iterations");
    expect(summary).toContain("Iteration 2: stopped");
    expect(summary).toContain("confidence=medium");
    expect(summary).toContain("codex_continue=yes");
    expect(summary).toContain("next_focus=Check title wording");
    expect(summary).toContain("risk_flags=changed-target-document");
    expect(summary).not.toContain("old first iteration summary");
  });

  test("formatRunDecisionSummary falls back to latest iteration summary when final report is missing", () => {
    const summary = formatRunDecisionSummary(
      runFixture,
      [
        "# iteration-001/codex-decision-summary.md",
        "",
        "first iteration",
        "",
        "# iteration-002/codex-decision-summary.md",
        "",
        "second iteration"
      ].join("\n")
    );

    expect(summary).toContain("second iteration");
    expect(summary).not.toContain("first iteration");
  });

  test("formatRunDecisionSummary falls back to user-facing run state when Codex output is missing", () => {
    expect(formatRunDecisionSummary({ ...runFixture, status: "codex_editing" }, "")).toBe(
      "Codex is still reviewing provider feedback for D:/project/docs/handoff.md."
    );
    expect(formatRunDecisionSummary({
      ...runFixture,
      status: "failed",
      errorJson: JSON.stringify({ message: "Codex task timed out" })
    }, "# final-report.md\n\nAutomation failed")).toBe(
      "Codex did not produce a review decision for D:/project/docs/handoff.md.\nReason: Codex task timed out"
    );
  });

  test("toRuntimeError preserves structured error code when present", () => {
    const error = new Error("daemon down") as Error & { code: string };
    error.code = "CCAGENT_DAEMON_UNAVAILABLE";

    expect(toRuntimeError(error)).toEqual({
      code: "CCAGENT_DAEMON_UNAVAILABLE",
      message: "daemon down"
    });
    expect(toRuntimeError("plain")).toEqual({ code: "CCAGENT_GUI_ERROR", message: "plain" });
  });
});

const emptyProvider: ProviderConfig = {
  id: "",
  displayName: "",
  mode: "openai-compatible",
  baseUrl: "",
  apiKeyRef: "",
  auth: {
    header: "Authorization",
    scheme: "Bearer"
  },
  models: {
    default: ""
  },
  capabilities: {
    streaming: true,
    tools: false,
    systemPrompt: true
  },
  enabled: true,
  createdAt: "",
  updatedAt: ""
};

const providerFixture: ProviderConfig = {
  ...emptyProvider,
  id: "glm",
  displayName: "Zhipu GLM",
  baseUrl: "https://open.bigmodel.cn/api/paas/v4",
  apiKeyRef: "ccagent/providers/glm/api-key",
  models: {
    default: "glm-5.1"
  }
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
  maxIterations: 1,
  outputDir: "D:/project/.ccagent/runs/run_1",
  createdAt: "2026-06-08T10:00:00.000Z",
  updatedAt: "2026-06-08T10:00:01.000Z",
  providers: [],
  iterations: []
};
