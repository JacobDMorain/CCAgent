import { spawn } from "node:child_process";
import { CCAgentError, ErrorCodes } from "@ccagent/core";

export async function checkClaudeBinary(claudePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(claudePath, ["--version"], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.once("error", (error) => {
      reject(new CCAgentError(ErrorCodes.ClaudeNotFound, error.message));
    });
    child.once("exit", (code) => {
      if (code !== 0) {
        reject(new CCAgentError(ErrorCodes.ClaudeUnsupported, "Claude version check failed"));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
