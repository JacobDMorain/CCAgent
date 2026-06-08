import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("documentation and packaging", () => {
  test("Task 18 required files exist", () => {
    for (const file of [
      "docs/codex-mcp-setup.md",
      "docs/provider-config.md",
      "docs/local-secrets.md",
      "docs/manual-evidence.example.json",
      "docs/release-checklist.md",
      "scripts/package-windows.ts",
      "scripts/acceptance-audit.ts",
      "scripts/local-runtime-acceptance.ts",
      "scripts/codex-mcp-acceptance.ts",
      "scripts/real-provider-acceptance.ts",
      "scripts/register-codex-mcp.ts"
    ]) {
      expect(existsSync(join(root, file)), file).toBe(true);
    }
  });

  test("Codex MCP setup guide covers startup, registration, examples, and troubleshooting", () => {
    const text = read("docs/codex-mcp-setup.md");
    for (const required of [
      "Start the daemon",
      "Run the GUI",
      "Register the MCP server",
      "pnpm codex:mcp:register",
      "apps/mcp-server/dist/apps/mcp-server/src/index.js",
      "ccagent.review_file",
      "ccagent.run_task",
      "daemon unavailable",
      "Claude binary missing",
      "provider missing",
      "API key missing",
      "path denied",
      "provider API error",
      "empty workspace root configuration",
      "max concurrent task limit reached",
      "daemon recovered an orphaned running task"
    ]) {
      expect(text).toContain(required);
    }
  });

  test("provider config guide documents templates and security notes", () => {
    const text = read("docs/provider-config.md");
    for (const required of [
      "GLM",
      "DeepSeek",
      "OpenAI-compatible",
      "Anthropic-compatible",
      "verify GLM and DeepSeek base URLs",
      "Anthropic-compatible mode passes the provider key",
      "127.0.0.1",
      "bearer auth",
      "localhost HTTPS"
    ]) {
      expect(text).toContain(required);
    }
  });

  test("release checklist contains all required gates", () => {
    const text = read("docs/release-checklist.md");
    for (const required of [
      "pnpm typecheck",
      "pnpm test",
      "pnpm acceptance:audit",
      "pnpm acceptance:local-runtime",
      "pnpm acceptance:codex-mcp",
      "pnpm acceptance:real-providers",
      "GUI task dashboard",
      "manual-evidence.json",
      "Playwright GUI smoke",
      "Manual provider test",
      "GLM and DeepSeek template base URLs",
      "Codex MCP call returns result",
      "Two-provider concurrency test",
      "Port exhaustion behavior",
      "Daemon recovery behavior",
      "Coverage thresholds meet or exceed 80%",
      "API keys are redacted from MCP output, GUI task data, and daemon logs"
    ]) {
      expect(text).toContain(required);
    }
  });

  test("local secrets guide documents required environment keys and safety rules", () => {
    const text = read("docs/local-secrets.md");
    for (const required of [
      "GLM_API_KEY",
      "DEEPSEEK_API_KEY",
      "PowerShell",
      ".env.local",
      "Do not paste real API keys",
      "pnpm.cmd acceptance:real-providers",
      "pnpm.cmd acceptance:audit"
    ]) {
      expect(text).toContain(required);
    }
  });

  test("Windows package manifest entrypoints point at built files", () => {
    const manifestPath = join(root, "dist/windows/manifest.json");
    expect(existsSync(manifestPath), manifestPath).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      entrypoints: Record<string, string>;
    };

    for (const [name, relativePath] of Object.entries(manifest.entrypoints)) {
      const fullPath = join(root, relativePath);
      expect(existsSync(fullPath), `${name}: ${relativePath}`).toBe(true);
    }
  });
});

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}
