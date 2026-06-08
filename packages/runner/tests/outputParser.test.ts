import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ErrorCodes } from "@ccagent/core";
import { parseClaudeJsonOutput, parseClaudeStreamJsonOutput } from "../src/index.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

describe("Claude output parser", () => {
  test("JSON fixture returns Review result text", () => {
    const stdout = fs.readFileSync(path.join(fixturesDir, "claude-json-output.json"), "utf8");

    expect(parseClaudeJsonOutput(stdout).content).toBe("Review result text");
  });

  test("NDJSON fixture returns final result", () => {
    const stdout = fs.readFileSync(path.join(fixturesDir, "claude-stream-json-output.ndjson"), "utf8");

    expect(parseClaudeStreamJsonOutput(stdout).content).toBe("Final stream result");
  });

  test("malformed JSON throws parse error", () => {
    expect(() => parseClaudeJsonOutput("{bad")).toThrowError(
      expect.objectContaining({ code: ErrorCodes.ParseError })
    );
  });
});
