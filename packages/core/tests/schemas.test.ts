import { describe, expect, test } from "vitest";
import { ErrorCodes, ReviewFileRequestSchema, RunTaskRequestSchema } from "../src/index.js";

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

  test("defines error codes referenced by implementation tasks", () => {
    expect(ErrorCodes.ProxyPortUnavailable).toBe("CCAGENT_PROXY_PORT_UNAVAILABLE");
    expect(ErrorCodes.ClaudeNotFound).toBe("CCAGENT_CLAUDE_NOT_FOUND");
    expect(ErrorCodes.ClaudeUnsupported).toBe("CCAGENT_CLAUDE_UNSUPPORTED");
    expect(ErrorCodes.TaskLimit).toBe("CCAGENT_TASK_LIMIT");
    expect(ErrorCodes.DaemonAuthUnavailable).toBe("CCAGENT_DAEMON_AUTH_UNAVAILABLE");
    expect(ErrorCodes.DaemonRecovered).toBe("CCAGENT_DAEMON_RECOVERED");
  });
});
