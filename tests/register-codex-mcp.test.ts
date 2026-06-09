import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { registerCodexMcp } from "../scripts/register-codex-mcp.js";

describe("register Codex MCP", () => {
  test("adds ccagent registration without daemon token values", () => {
    const root = workspaceRoot();
    const configPath = join(root, ".codex", "config.toml");
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(configPath, '[mcp_servers.figma]\ncommand = "node"\n');

    const result = registerCodexMcp({
      root,
      configPath,
      now: () => "2026-06-05T00:00:00.000Z"
    });

    const text = readFileSync(configPath, "utf8");
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(text).toContain("[mcp_servers.figma]");
    expect(text).toContain("[mcp_servers.ccagent]");
    expect(text).toContain('command = "node"');
    expect(text).toContain(`cwd = "${root.replaceAll("\\", "/")}"`);
    expect(text).toContain("apps/mcp-server/dist/apps/mcp-server/src/index.js");
    expect(text).toContain("[mcp_servers.ccagent.env]");
    expect(text).toContain("CCAGENT_LOCAL_CONFIG_PATH");
    expect(text).toContain("ccagent.local-config.md");
    expect(text).not.toContain("CCAGENT_DAEMON_TOKEN");
    expect(text).not.toContain("ccagent_");
  });

  test("replaces an existing ccagent block", () => {
    const root = workspaceRoot();
    const configPath = join(root, ".codex", "config.toml");
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(
      configPath,
      [
        "[mcp.ccagent]",
        'command = "old"',
        "[mcp.ccagent.env]",
        'CCAGENT_DAEMON_TOKEN = "ccagent_old_secret"',
        "[mcp_servers.other]",
        'command = "node"'
      ].join("\n")
    );

    registerCodexMcp({
      root,
      configPath,
      now: () => "2026-06-05T00:00:00.000Z"
    });

    const text = readFileSync(configPath, "utf8");
    expect(text).toContain("[mcp_servers.other]");
    expect(text).toContain("[mcp_servers.ccagent]");
    expect(text).not.toContain("[mcp.ccagent]");
    expect(text).toContain('command = "node"');
    expect(text).not.toContain('command = "old"');
    expect(text).not.toContain("ccagent_old_secret");
  });
});

function workspaceRoot(): string {
  const root = join(tmpdir(), `ccagent-register-mcp-test-${Date.now()}-${Math.random()}`);
  mkdirSync(root, { recursive: true });
  return root;
}
