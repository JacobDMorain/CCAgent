import { describe, expect, test } from "vitest";
import {
  AutomationRunRequestSchema,
  ErrorCodes,
  PromptTemplateSchema,
  ReviewFileRequestSchema,
  RunTaskRequestSchema
} from "../src/index.js";

describe("core schemas", () => {
  test("valid RunTaskRequest parses and defaults mode, timeout, and maxOutputBytes", () => {
    const parsed = RunTaskRequestSchema.parse({
      provider: "glm",
      cwd: "D:/project",
      prompt: "Review test.md"
    });

    expect(parsed.mode).toBe("sync");
    expect(parsed.timeoutMs).toBe(600000);
    expect(parsed.maxOutputBytes).toBe(131072);
  });

  test("invalid provider id fails", () => {
    expect(() =>
      RunTaskRequestSchema.parse({
        provider: "../bad",
        cwd: "D:/project",
        prompt: "Review test.md"
      })
    ).toThrow();
  });

  test("timeout above max fails", () => {
    expect(() =>
      RunTaskRequestSchema.parse({
        provider: "glm",
        cwd: "D:/project",
        prompt: "Review test.md",
        timeoutMs: 3600001
      })
    ).toThrow();
  });

  test("reviewStyle defaults to full and language is preserved", () => {
    const parsed = ReviewFileRequestSchema.parse({
      provider: "glm",
      cwd: "D:/project",
      file: "test.md",
      language: "en-US"
    });

    expect(parsed.reviewStyle).toBe("full");
    expect(parsed.language).toBe("en-US");
  });

  test("automation run request defaults to fully automatic full review", () => {
    const parsed = AutomationRunRequestSchema.parse({
      cwd: "D:/project",
      file: "docs/handoff.md",
      reviewers: [{ provider: "glm" }],
      claudeTemplateId: "default-claude-review-full",
      codexTemplateId: "default-codex-edit"
    });

    expect(parsed.reviewStyle).toBe("full");
    expect(parsed.fullyAuto).toBe(true);
    expect(parsed.maxIterations).toBe(1);
    expect(parsed.timeoutMs).toBe(600000);
    expect(parsed.maxOutputBytes).toBe(131072);
  });

  test("automation run request accepts bounded iterative review count", () => {
    const parsed = AutomationRunRequestSchema.parse({
      cwd: "D:/project",
      file: "docs/handoff.md",
      reviewers: [{ provider: "glm" }],
      claudeTemplateId: "default-claude-review-full",
      codexTemplateId: "default-codex-edit",
      maxIterations: 3
    });

    expect(parsed.maxIterations).toBe(3);
    expect(() =>
      AutomationRunRequestSchema.parse({
        cwd: "D:/project",
        file: "docs/handoff.md",
        reviewers: [{ provider: "glm" }],
        claudeTemplateId: "default-claude-review-full",
        codexTemplateId: "default-codex-edit",
        maxIterations: 0
      })
    ).toThrow();
  });

  test("prompt template schema requires known template kind", () => {
    expect(
      PromptTemplateSchema.parse({
        id: "template-1",
        kind: "codex-edit",
        name: "Codex edit",
        description: "Edit with merged review packet",
        version: 1,
        content: "Read {reviewPacket}",
        requiredVariables: ["reviewPacket"],
        isDefault: true,
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T10:00:00.000Z"
      })
    ).toMatchObject({ kind: "codex-edit" });

    expect(() =>
      PromptTemplateSchema.parse({
        id: "bad",
        kind: "unknown",
        name: "Bad",
        description: "Bad",
        version: 1,
        content: "Bad",
        requiredVariables: [],
        isDefault: false,
        createdAt: "2026-06-08T10:00:00.000Z",
        updatedAt: "2026-06-08T10:00:00.000Z"
      })
    ).toThrow();
  });

  test("defines error codes referenced by implementation tasks", () => {
    expect(ErrorCodes.ProxyPortUnavailable).toBe("CCAGENT_PROXY_PORT_UNAVAILABLE");
    expect(ErrorCodes.ClaudeNotFound).toBe("CCAGENT_CLAUDE_NOT_FOUND");
    expect(ErrorCodes.ClaudeUnsupported).toBe("CCAGENT_CLAUDE_UNSUPPORTED");
    expect(ErrorCodes.TaskLimit).toBe("CCAGENT_TASK_LIMIT");
    expect(ErrorCodes.DaemonAuthUnavailable).toBe("CCAGENT_DAEMON_AUTH_UNAVAILABLE");
    expect(ErrorCodes.DaemonRecovered).toBe("CCAGENT_DAEMON_RECOVERED");
  });
});
