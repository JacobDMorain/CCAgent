import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ErrorCodes } from "@ccagent/core";
import { runClaude } from "../src/index.js";

describe("Claude runner", () => {
  test("fake Claude success returns parsed content and captures stdout", async () => {
    const fakeClaude = writeFakeClaude("success");
    const stdout: string[] = [];

    const result = await runClaude({
      taskId: "task_1",
      cwd: path.dirname(fakeClaude),
      prompt: "Review",
      claudePath: process.execPath,
      claudeArgsPrefix: [fakeClaude],
      env: { ANTHROPIC_MODEL: "glm-5.1" },
      timeoutMs: 5000,
      outputFormat: "json",
      onStdout: (text) => stdout.push(text),
      onStderr: () => {}
    });

    expect(result.content).toBe("Fake review result");
    expect(stdout.join("")).toContain("Fake review result");
  });

  test("fake Claude non-zero exit returns structured error including stderr", async () => {
    const fakeClaude = writeFakeClaude("fail");

    await expect(
      runClaude({
        taskId: "task_1",
        cwd: path.dirname(fakeClaude),
        prompt: "Review",
        claudePath: process.execPath,
        claudeArgsPrefix: [fakeClaude],
        env: {},
        timeoutMs: 5000,
        outputFormat: "json",
        onStdout: () => {},
        onStderr: () => {}
      })
    ).rejects.toMatchObject({
      code: "CCAGENT_CLAUDE_EXIT"
    });
  });

  test("timeout cancels long-running fake Claude", async () => {
    const fakeClaude = writeFakeClaude("sleep");

    await expect(
      runClaude({
        taskId: "task_1",
        cwd: path.dirname(fakeClaude),
        prompt: "Review",
        claudePath: process.execPath,
        claudeArgsPrefix: [fakeClaude],
        env: {},
        timeoutMs: 50,
        outputFormat: "json",
        onStdout: () => {},
        onStderr: () => {}
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.Timeout
    });
  });

  test("missing Claude binary returns not found error", async () => {
    await expect(
      runClaude({
        taskId: "task_1",
        cwd: os.tmpdir(),
        prompt: "Review",
        claudePath: "Z:/missing/claude.exe",
        env: {},
        timeoutMs: 5000,
        outputFormat: "json",
        onStdout: () => {},
        onStderr: () => {}
      })
    ).rejects.toMatchObject({
      code: ErrorCodes.ClaudeNotFound
    });
  });
});

function writeFakeClaude(mode: "success" | "fail" | "sleep"): string {
  const file = path.join(os.tmpdir(), `fake-claude-${mode}-${crypto.randomUUID()}.mjs`);
  const source = {
    success:
      'console.log(JSON.stringify({type:"result",subtype:"success",result:"Fake review result"}));',
    fail: 'console.error("fake failure"); process.exit(2);',
    sleep: 'setTimeout(() => console.log("done"), 10000);'
  }[mode];
  fs.writeFileSync(file, source, "utf8");
  return file;
}
