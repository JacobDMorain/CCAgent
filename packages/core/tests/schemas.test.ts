import { describe, expect, test } from "vitest";
import {
  AutomationRunRequestSchema,
  ErrorCodes,
  PromptTemplateSchema,
  ReviewRoleSchema,
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

  test("review role schema accepts reusable global and generated roles", () => {
    const parsed = ReviewRoleSchema.parse({
      id: "document-structure",
      group: "core-technology",
      name: "文档结构审查员",
      description: "检查章节结构和读者路径。",
      focusAreas: ["章节结构", "重复内容"],
      defaultSelected: true,
      source: "global",
      createdAt: "2026-06-10T10:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z"
    });

    expect(parsed).toMatchObject({
      id: "document-structure",
      group: "core-technology",
      source: "global",
      defaultSelected: true
    });
    expect("prompt" in parsed).toBe(false);
    expect("outputInstructions" in parsed).toBe(false);
    expect(() =>
      ReviewRoleSchema.parse({
        ...parsed,
        id: "../bad"
      })
    ).toThrow();
    expect(() =>
      ReviewRoleSchema.parse({
        ...parsed,
        source: "project"
      })
    ).toThrow();
  });

  test("review role schema backfills groups for persisted legacy roles", () => {
    expect(
      ReviewRoleSchema.parse({
        id: "document-structure",
        name: "文档结构审查员",
        description: "检查章节结构。",
        focusAreas: ["章节结构"],
        defaultSelected: true,
        source: "global",
        createdAt: "2026-06-10T10:00:00.000Z",
        updatedAt: "2026-06-10T10:00:00.000Z"
      }).group
    ).toBe("documentation-quality");

    expect(
      ReviewRoleSchema.parse({
        id: "legacy-specialist",
        name: "Legacy specialist",
        description: "Old custom role.",
        focusAreas: ["legacy"],
        defaultSelected: false,
        source: "global",
        createdAt: "2026-06-10T10:00:00.000Z",
        updatedAt: "2026-06-10T10:00:00.000Z"
      }).group
    ).toBe("custom");
  });

  test("automation run request can carry reviewer role ids and role snapshots", () => {
    const parsed = AutomationRunRequestSchema.parse({
      cwd: "D:/project",
      file: "docs/handoff.md",
      reviewers: [{ provider: "glm", roleIds: ["document-structure", "fact-consistency"] }],
      roles: [
        {
          id: "document-structure",
          group: "core-technology",
          name: "文档结构审查员",
          description: "检查结构。",
          focusAreas: ["结构"],
          defaultSelected: true,
          source: "global",
          createdAt: "2026-06-10T10:00:00.000Z",
          updatedAt: "2026-06-10T10:00:00.000Z"
        }
      ],
      claudeTemplateId: "default-claude-review-full",
      codexTemplateId: "default-codex-edit"
    });

    expect(parsed.reviewers[0].roleIds).toEqual(["document-structure", "fact-consistency"]);
    expect(parsed.roles?.[0].group).toBe("core-technology");
    expect(parsed.roles?.[0].name).toBe("文档结构审查员");
    expect("prompt" in parsed.roles![0]).toBe(false);
    expect("outputInstructions" in parsed.roles![0]).toBe(false);
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
