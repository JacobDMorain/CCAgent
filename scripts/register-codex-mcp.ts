import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface RegisterCodexMcpResult {
  configPath: string;
  backupPath?: string;
  entrypoint: string;
}

interface RegisterCodexMcpOptions {
  root: string;
  configPath?: string;
  now?: () => string;
}

export function registerCodexMcp(options: RegisterCodexMcpOptions): RegisterCodexMcpResult {
  const configPath = options.configPath ?? join(homedir(), ".codex", "config.toml");
  const now = options.now ?? (() => new Date().toISOString());
  const entrypoint = join(
    options.root,
    "apps",
    "mcp-server",
    "dist",
    "apps",
    "mcp-server",
    "src",
    "index.js"
  ).replaceAll("\\", "/");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const backupPath = existsSync(configPath)
    ? `${configPath}.bak-ccagent-${now().replace(/[:.]/g, "-")}`
    : undefined;
  if (backupPath) {
    writeFileSync(backupPath, existing);
  }

  const next = `${removeExistingCcagentBlock(existing).trimEnd()}

[mcp_servers.ccagent]
command = "node"
args = ["${entrypoint}"]
`;

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, next, "utf8");
  return { configPath, backupPath, entrypoint };
}

function removeExistingCcagentBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const result: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (isCcagentHeader(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\s*\[/.test(line) && !isCcagentSubHeader(line)) {
      skipping = false;
    }
    if (!skipping) {
      result.push(line);
    }
  }
  return result.join("\n");
}

function isCcagentHeader(line: string): boolean {
  return /^\s*\[(?:mcpServers|mcp_servers|mcp)\.ccagent\]\s*$/.test(line);
}

function isCcagentSubHeader(line: string): boolean {
  return /^\s*\[(?:mcpServers|mcp_servers|mcp)\.ccagent\./.test(line);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = registerCodexMcp({
    root: dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
  });
  console.log(`Registered ccagent MCP in ${result.configPath}`);
  if (result.backupPath) {
    console.log(`Backup written to ${result.backupPath}`);
  }
}
