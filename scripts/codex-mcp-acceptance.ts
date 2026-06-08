import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface CodexMcpAcceptanceResult {
  status: "passed" | "failed";
  generatedAt: string;
  reportPath: string;
  configPath: string;
  evidence: string[];
  error?: string;
  manualEvidencePath?: string;
}

interface CodexMcpAcceptanceOptions {
  root: string;
  configPath?: string;
  now?: () => string;
}

export function runCodexMcpAcceptance(options: CodexMcpAcceptanceOptions): CodexMcpAcceptanceResult {
  const now = options.now ?? (() => new Date().toISOString());
  const generatedAt = now();
  const reportDir = join(options.root, "dist", "acceptance");
  const reportPath = join(reportDir, "codex-mcp-acceptance.json");
  const configPath = options.configPath ?? join(homedir(), ".codex", "config.toml");
  mkdirSync(reportDir, { recursive: true });

  const evidence: string[] = [];
  let status: "passed" | "failed" = "failed";
  let error: string | undefined;
  let manualEvidencePath: string | undefined;

  try {
    if (!existsSync(configPath)) {
      throw new Error(`Codex config not found at ${configPath}`);
    }
    const text = readFileSync(configPath, "utf8");
    const block = findCcagentMcpBlock(text);
    if (!block) {
      throw new Error("Codex config does not contain a ccagent MCP server block");
    }

    const expectedEntry = normalize(
      join(options.root, "apps", "mcp-server", "dist", "apps", "mcp-server", "src", "index.js")
    ).replaceAll("\\", "/");
    const blockText = block.join("\n").replaceAll("\\", "/");
    if (!/\bcommand\s*=\s*["']node["']/.test(blockText) && !/"command"\s*:\s*"node"/.test(blockText)) {
      throw new Error("ccagent MCP server command is not node");
    }
    if (!blockText.includes(expectedEntry)) {
      throw new Error("ccagent MCP server args do not point at the built MCP server entrypoint");
    }

    evidence.push("Codex config contains a ccagent MCP server block");
    evidence.push("ccagent MCP command is node");
    evidence.push("ccagent MCP args point at apps/mcp-server/dist/apps/mcp-server/src/index.js");
    if (blockText.includes("CCAGENT_DAEMON_URL")) {
      evidence.push("ccagent MCP config names CCAGENT_DAEMON_URL");
    }
    if (blockText.includes("CCAGENT_DAEMON_TOKEN")) {
      evidence.push("ccagent MCP config names CCAGENT_DAEMON_TOKEN without recording its value");
    }
    status = "passed";
    manualEvidencePath = writeManualEvidence(options.root, generatedAt, evidence);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    evidence.push(error);
  }

  const result: CodexMcpAcceptanceResult = {
    status,
    generatedAt,
    reportPath,
    configPath,
    evidence,
    error,
    manualEvidencePath
  };
  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  return result;
}

function findCcagentMcpBlock(text: string): string[] | undefined {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!isCcagentHeader(lines[index])) {
      continue;
    }
    const block = [lines[index]];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*\[/.test(lines[cursor]) && !isCcagentSubHeader(lines[cursor])) {
        break;
      }
      block.push(lines[cursor]);
    }
    return block;
  }

  if (/"ccagent"\s*:/.test(text)) {
    return text.split(/\r?\n/);
  }
  return undefined;
}

function isCcagentHeader(line: string): boolean {
  return /^\s*\[(?:mcpServers|mcp_servers|mcp)\.ccagent\]\s*$/.test(line);
}

function isCcagentSubHeader(line: string): boolean {
  return /^\s*\[(?:mcpServers|mcp_servers|mcp)\.ccagent\./.test(line);
}

function writeManualEvidence(root: string, checkedAt: string, evidence: string[]): string {
  const target = join(root, "dist", "acceptance", "manual-evidence.json");
  const existing = readExistingManualEvidence(target);
  existing.items = {
    ...existing.items,
    "codex-mcp-registration": {
      status: "passed",
      checkedAt,
      checkedBy: "scripts/codex-mcp-acceptance.ts",
      evidence
    }
  };
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(existing, null, 2));
  return target;
}

function readExistingManualEvidence(path: string): { items?: Record<string, unknown> } {
  if (!existsSync(path)) {
    return { items: {} };
  }
  return JSON.parse(readFileSync(path, "utf8")) as { items?: Record<string, unknown> };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = runCodexMcpAcceptance({
    root: dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
  });
  console.log(`Codex MCP acceptance ${result.status}; report=${result.reportPath}`);
  if (result.status !== "passed") {
    process.exitCode = 1;
  }
}
