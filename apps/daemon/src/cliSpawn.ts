import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

export function spawnCli(command: string, args: string[], options: SpawnOptionsWithoutStdio = {}) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", quoteForCmd(command), ...args], {
      ...options,
      windowsHide: options.windowsHide ?? true
    });
  }

  return spawn(command, args, options);
}

function quoteForCmd(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}
