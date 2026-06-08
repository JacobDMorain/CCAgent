import { describe, expect, test } from "vitest";
import { buildReviewFilePrompt, buildRunTaskPrompt } from "../src/index.js";

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
});
