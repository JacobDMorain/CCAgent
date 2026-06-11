import { spawn } from "node:child_process";
import { CCAgentError, ErrorCodes } from "@ccagent/core";
import { parseClaudeJsonOutput, parseClaudeStreamJsonOutput, type ParsedClaudeOutput } from "./outputParser.js";
import { terminateProcessTree } from "./processTree.js";

export interface ClaudeRunInput {
  taskId: string;
  cwd: string;
  prompt: string;
  claudePath: string;
  claudeArgsPrefix?: string[];
  env: Record<string, string>;
  timeoutMs?: number;
  outputFormat: "json" | "stream-json";
  onStdout(text: string): void;
  onStderr(text: string): void;
  signal?: AbortSignal;
}

export async function runClaude(input: ClaudeRunInput): Promise<ParsedClaudeOutput> {
  const args = [
    ...(input.claudeArgsPrefix ?? []),
    "-p",
    input.prompt,
    "--output-format",
    input.outputFormat
  ];
  const child = spawn(input.claudePath, args, {
    cwd: input.cwd,
    env: { ...process.env, ...input.env },
    detached: process.platform !== "win32",
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  let settled = false;

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    input.onStdout(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    input.onStderr(text);
  });

  return await new Promise<ParsedClaudeOutput>((resolve, reject) => {
    const timeout = input.timeoutMs && input.timeoutMs > 0
      ? setTimeout(() => {
          void terminate("timeout");
        }, input.timeoutMs)
      : undefined;

    const abortListener = () => {
      void terminate("cancelled");
    };
    input.signal?.addEventListener("abort", abortListener, { once: true });

    child.once("error", (error) => {
      cleanup();
      reject(new CCAgentError(ErrorCodes.ClaudeNotFound, error.message));
    });

    child.once("exit", (code) => {
      cleanup();
      if (settled) {
        return;
      }
      if (code !== 0) {
        reject(
          new CCAgentError(
            "CCAGENT_CLAUDE_EXIT",
            `Claude exited with code ${code}`,
            stderr
          )
        );
        return;
      }

      try {
        resolve(
          input.outputFormat === "json"
            ? parseClaudeJsonOutput(stdout)
            : parseClaudeStreamJsonOutput(stdout)
        );
      } catch (error) {
        reject(error);
      }
    });

    async function terminate(reason: "timeout" | "cancelled"): Promise<void> {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (child.pid) {
        await terminateProcessTree(child.pid);
      }
      reject(
        new CCAgentError(
          reason === "timeout" ? ErrorCodes.Timeout : ErrorCodes.Cancelled,
          reason === "timeout" ? "Claude task timed out" : "Claude task was cancelled"
        )
      );
    }

    function cleanup(): void {
      if (timeout) {
        clearTimeout(timeout);
      }
      input.signal?.removeEventListener("abort", abortListener);
    }
  });
}
