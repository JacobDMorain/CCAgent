import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { runLocalRuntimeAcceptance } from "../scripts/local-runtime-acceptance.js";

describe("local runtime acceptance", () => {
  test("writes manual evidence for daemon, GUI, and unchanged Claude settings", async () => {
    const root = workspaceRoot();
    const claudeSettings = join(root, ".claude", "settings.json");
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(claudeSettings, JSON.stringify({ theme: "dark" }));

    const result = await runLocalRuntimeAcceptance({
      root,
      claudeSettingsPath: claudeSettings,
      now: () => "2026-06-05T00:00:00.000Z",
      runGuiSmoke: async () => "gui smoke passed",
      runGuiDashboardSmoke: async () => "dashboard smoke passed"
    });

    expect(result.status).toBe("passed");
    const manualEvidence = readFileSync(join(root, "dist", "acceptance", "manual-evidence.json"), "utf8");
    expect(manualEvidence).toContain("daemon-starts");
    expect(manualEvidence).toContain("gui-starts");
    expect(manualEvidence).toContain("gui-dashboard-completed-task");
    expect(manualEvidence).toContain("global-claude-settings-untouched");
  });

  test("fails when GUI smoke fails and does not write manual evidence", async () => {
    const root = workspaceRoot();
    const result = await runLocalRuntimeAcceptance({
      root,
      now: () => "2026-06-05T00:00:00.000Z",
      runGuiSmoke: async () => {
        throw new Error("gui failed");
      },
      runGuiDashboardSmoke: async () => "dashboard smoke passed"
    });

    expect(result.status).toBe("failed");
    expect(result.checks.gui).toMatchObject({ status: "failed" });
    expect(existsSync(join(root, "dist", "acceptance", "manual-evidence.json"))).toBe(false);
  });
});

function workspaceRoot(): string {
  return join(tmpdir(), `ccagent-local-runtime-test-${Date.now()}-${Math.random()}`);
}
