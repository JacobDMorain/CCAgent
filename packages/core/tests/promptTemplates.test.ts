import { describe, expect, test } from "vitest";
import {
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

  test("default prompt templates cover Claude review and Codex edit variables", () => {
    const templates = createDefaultPromptTemplates("2026-06-08T10:00:00.000Z");
    const codexTemplate = templates.find((template) => template.id === "default-codex-edit");

    expect(templates).toEqual([
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
    ]);
    expect(codexTemplate?.content).toContain("adjudicate the provider review findings");
    expect(codexTemplate?.content).toContain("Do not replace the target document with a different file");
    expect(codexTemplate?.content).toContain("You may inspect surrounding repository context");
  });
});
