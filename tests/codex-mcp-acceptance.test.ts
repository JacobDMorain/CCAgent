import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { runCodexMcpAcceptance } from "../scripts/codex-mcp-acceptance.js";

describe("Codex MCP acceptance", () => {
  test("fails without a ccagent MCP registration", () => {
    const root = workspaceRoot();
    const configPath = join(root, "config.toml");
    writeFileSync(configPath, "[mcp_servers.figma]\ncommand = \"node\"\n");

    const result = runCodexMcpAcceptance({
      root,
      configPath,
      now: () => "2026-06-05T00:00:00.000Z"
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("ccagent MCP server block");
    expect(existsSync(join(root, "dist", "acceptance", "codex-mcp-acceptance.json"))).toBe(true);
    expect(existsSync(join(root, "dist", "acceptance", "manual-evidence.json"))).toBe(false);
  });

  test("writes codex MCP registration evidence without recording token values", () => {
    const root = workspaceRoot();
    const configPath = join(root, "config.toml");
    const mcpEntry = join(root, "apps", "mcp-server", "dist", "apps", "mcp-server", "src", "index.js").replaceAll(
      "\\",
      "/"
    );
    writeFileSync(
      configPath,
      [
        "[mcp_servers.ccagent]",
        'command = "node"',
        `args = ["${mcpEntry}"]`,
        '[mcp_servers.ccagent.env]',
        'CCAGENT_DAEMON_URL = "http://127.0.0.1:47621"',
        'CCAGENT_DAEMON_TOKEN = "ccagent_secret_should_not_be_copied"'
      ].join("\n")
    );

    const result = runCodexMcpAcceptance({
      root,
      configPath,
      now: () => "2026-06-05T00:00:00.000Z"
    });

    expect(result.status).toBe("passed");
    const manualEvidence = readFileSync(join(root, "dist", "acceptance", "manual-evidence.json"), "utf8");
    expect(manualEvidence).toContain("codex-mcp-registration");
    expect(manualEvidence).toContain("CCAGENT_DAEMON_TOKEN without recording its value");
    expect(manualEvidence).not.toContain("ccagent_secret_should_not_be_copied");
  });
});

function workspaceRoot(): string {
  const root = join(tmpdir(), `ccagent-codex-mcp-test-${Date.now()}-${Math.random()}`);
  mkdirSync(root, { recursive: true });
  return root;
}
