import { CCAgentError, ErrorCodes } from "@ccagent/core";

export interface ParsedClaudeOutput {
  content: string;
  summary?: string;
  raw: string;
}

export function parseClaudeJsonOutput(stdout: string): ParsedClaudeOutput {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown; summary?: unknown };
    if (typeof parsed.result !== "string") {
      throw new Error("missing result string");
    }

    return {
      content: parsed.result,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      raw: stdout
    };
  } catch (error) {
    throw new CCAgentError(
      ErrorCodes.ParseError,
      `failed to parse Claude JSON output: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function parseClaudeStreamJsonOutput(stdout: string): ParsedClaudeOutput {
  try {
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    let content = "";
    for (const line of lines) {
      const parsed = JSON.parse(line) as {
        result?: unknown;
        message?: { content?: Array<{ type: string; text?: string }> };
      };
      if (typeof parsed.result === "string") {
        content = parsed.result;
      } else if (!content && Array.isArray(parsed.message?.content)) {
        content += parsed.message.content
          .filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("");
      }
    }

    if (!content) {
      throw new Error("missing stream result");
    }

    return { content, raw: stdout };
  } catch (error) {
    throw new CCAgentError(
      ErrorCodes.ParseError,
      `failed to parse Claude stream JSON output: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
