import { describe, expect, test } from "vitest";
import {
  createBuiltInReviewRoles,
  buildReviewFilePrompt,
  buildRunTaskPrompt,
  createDefaultPromptTemplates,
  renderPromptTemplate
} from "../src/index.js";

describe("prompt templates", () => {
  test("review prompt includes file path, style, language, and no-modify instruction", () => {
    const prompt = buildReviewFilePrompt({
      provider: "glm",
      cwd: "D:/project",
      file: "test.md",
      reviewStyle: "bugs",
      language: "en-US"
    });

    expect(prompt).toContain("Review the file: test.md");
    expect(prompt).toContain("Review style: bugs");
    expect(prompt).toContain("Return the result in en-US.");
    expect(prompt).toContain("Do not modify the file.");
  });

  test("review prompt falls back to Chinese guidance", () => {
    const prompt = buildReviewFilePrompt({
      provider: "glm",
      cwd: "D:/project",
      file: "test.md"
    });

    expect(prompt).toContain("use Chinese unless the file itself clearly requires another language");
  });

  test("run task prompt wraps and preserves original prompt", () => {
    const prompt = buildRunTaskPrompt("Check the README exactly.");

    expect(prompt).toContain("Execute the following task in the working directory.");
    expect(prompt).toContain("Check the README exactly.");
  });

  test("renders exact template variables and reports missing required variables", () => {
    expect(
      renderPromptTemplate("Review {file} in {language}", {
        file: "handoff.md",
        language: "Chinese"
      })
    ).toBe("Review handoff.md in Chinese");

    expect(() => renderPromptTemplate("Review {file} with {provider}", { file: "handoff.md" }))
      .toThrow(/provider/);
  });

  test("default prompt templates cover English and Chinese Claude/Codex workflows", () => {
    const templates = createDefaultPromptTemplates("2026-06-08T10:00:00.000Z");
    const codexTemplate = templates.find((template) => template.id === "default-codex-edit");
    const zhClaudeTemplate = templates.find((template) => template.id === "default-claude-review-full-zh");
    const zhCodexTemplate = templates.find((template) => template.id === "default-codex-edit-zh");

    expect(templates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "default-claude-review-full",
        kind: "claude-review",
        isDefault: true,
        requiredVariables: expect.arrayContaining(["file", "provider", "reviewStyle"])
      }),
      expect.objectContaining({
        id: "default-codex-edit",
        kind: "codex-edit",
        isDefault: true,
        requiredVariables: expect.arrayContaining(["targetDocument", "reviewPacket", "runId"])
      })
    ]));
    expect(codexTemplate?.content).toContain("adjudicate the provider review findings");
    expect(codexTemplate?.content).toContain("Do not replace the target document with a different file");
    expect(codexTemplate?.content).toContain("You may inspect surrounding repository context");
    expect(zhClaudeTemplate).toMatchObject({
      kind: "claude-review",
      name: "完整 Claude 评审",
      isDefault: true
    });
    expect(zhClaudeTemplate?.content).toContain("请使用中文输出");
    expect(zhCodexTemplate).toMatchObject({
      kind: "codex-edit",
      name: "Codex 根据评审包修改文档",
      isDefault: true
    });
    expect(zhCodexTemplate?.content).toContain("请使用中文输出面向用户的总结");
    expect(zhCodexTemplate?.content).toContain("continue: yes|no");
    expect(zhCodexTemplate?.content).toContain("confidence: high|medium|low");
  });

  test("built-in review roles seed the default review group", () => {
    const roles = createBuiltInReviewRoles("2026-06-10T10:00:00.000Z");

    expect(roles.map((role) => role.id)).toEqual([
      "document-structure",
      "fact-consistency",
      "actionability",
      "risk-opposition",
      "language-expression"
    ]);
    expect(roles.filter((role) => role.defaultSelected).map((role) => role.name)).toEqual([
      "文档结构审查员",
      "事实一致性审查员",
      "可执行性审查员"
    ]);
    expect(roles.every((role) => role.source === "global")).toBe(true);
    expect(roles.map((role) => role.group)).toEqual([
      "documentation-quality",
      "documentation-quality",
      "product-delivery",
      "risk-opposition",
      "user-perspective"
    ]);
    expect(roles[0]).toMatchObject({
      id: "document-structure",
      description: expect.stringContaining("章节结构"),
      focusAreas: expect.arrayContaining(["章节结构"])
    });
    expect("prompt" in roles[0]).toBe(false);
    expect("outputInstructions" in roles[0]).toBe(false);
  });

  test("default Claude review templates expose roleTeam variable", () => {
    const templates = createDefaultPromptTemplates("2026-06-10T10:00:00.000Z");
    const claudeTemplate = templates.find((template) => template.id === "default-claude-review-full");
    const zhClaudeTemplate = templates.find((template) => template.id === "default-claude-review-full-zh");

    expect(claudeTemplate?.requiredVariables).toContain("roleTeam");
    expect(claudeTemplate?.content).toContain("{roleTeam}");
    expect(claudeTemplate?.content).toContain("Role team");
    expect(zhClaudeTemplate?.requiredVariables).toContain("roleTeam");
    expect(zhClaudeTemplate?.content).toContain("{roleTeam}");
    expect(zhClaudeTemplate?.content).toContain("角色小组");
  });
});
