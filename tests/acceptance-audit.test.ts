import { describe, expect, test } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildAcceptanceAudit } from "../scripts/acceptance-audit.js";

describe("acceptance audit", () => {
  test("classifies real-environment gates separately from automated evidence", () => {
    const audit = buildAcceptanceAudit(
      copyManualEvidenceFixtureRoot(process.cwd()),
      "2026-06-05T00:00:00.000Z"
    );

    expect(audit.readyForRelease).toBe(false);
    expect(audit.summary.missing).toBe(0);
    expect(audit.summary["manual-required"]).toBeGreaterThan(0);
    expect(audit.items.find((item) => item.id === "codex-review-file-glm")).toMatchObject({
      status: "manual-required"
    });
    expect(audit.items.find((item) => item.id === "startup-recovery")).toMatchObject({
      status: "automated"
    });
  });

  test("accepts complete manual evidence without exposing secrets", () => {
    const root = process.cwd();
    const workspace = copyManualEvidenceFixtureRoot(root);
    const audit = buildAcceptanceAudit(workspace, "2026-06-05T00:00:00.000Z");
    const manualIds = audit.items.filter((item) => item.status === "manual-required").map((item) => item.id);

    writeFileSync(
      join(workspace, "dist", "acceptance", "manual-evidence.json"),
      JSON.stringify(
        {
          items: Object.fromEntries(
            manualIds.map((id) => [
              id,
              {
                status: "passed",
                checkedAt: "2026-06-05T08:00:00.000Z",
                checkedBy: "local acceptance",
                evidence: [`verified ${id} in real local Codex GUI scenario`]
              }
            ])
          )
        },
        null,
        2
      )
    );

    const verified = buildAcceptanceAudit(workspace, "2026-06-05T08:01:00.000Z");
    expect(verified.readyForRelease).toBe(true);
    expect(verified.summary["manual-required"]).toBe(0);
    expect(verified.summary["manual-verified"]).toBe(manualIds.length);
  });

  test("rejects manual evidence that contains secret-like text", () => {
    const workspace = copyManualEvidenceFixtureRoot(process.cwd());
    writeFileSync(
      join(workspace, "dist", "acceptance", "manual-evidence.json"),
      JSON.stringify({
        items: {
          "glm-real-provider": {
            status: "passed",
            checkedAt: "2026-06-05T08:00:00.000Z",
            checkedBy: "local acceptance",
            evidence: ["bad evidence includes sk-1234567890abcdef"]
          }
        }
      })
    );

    const audit = buildAcceptanceAudit(workspace, "2026-06-05T08:01:00.000Z");
    expect(audit.readyForRelease).toBe(false);
    expect(audit.items.find((item) => item.id === "glm-real-provider")).toMatchObject({
      status: "missing"
    });
    expect(audit.items.find((item) => item.id === "glm-real-provider")?.evidence).toContain(
      "missing: manual evidence glm-real-provider evidence contains secret-like text"
    );
  });
});

function copyManualEvidenceFixtureRoot(sourceRoot: string): string {
  const workspace = join(tmpdir(), `ccagent-acceptance-audit-${Date.now()}-${Math.random()}`);
  mkdirSync(join(workspace, "dist", "acceptance"), { recursive: true });
  for (const path of [
    "apps/daemon/src/index.ts",
    "apps/daemon/src/taskManager.ts",
    "apps/daemon/tests/daemon-api.test.ts",
    "apps/gui/src/renderer/App.tsx",
    "apps/gui/src/renderer/components/TaskTable.tsx",
    "apps/gui/tests/electron-dashboard.spec.ts",
    "apps/gui/tests/electron-smoke.spec.ts",
    "apps/gui/tests/gui-renderer.test.tsx",
    "docs/codex-mcp-setup.md",
    "docs/provider-config.md",
    "docs/release-checklist.md",
    "packages/secrets/tests/secretStore.test.ts",
    "packages/core/tests/pathPolicy.test.ts",
    "packages/provider/src/providerConfig.ts",
    "packages/proxy/tests/portAllocator.test.ts",
    "package.json",
    "tests/e2e/concurrent-providers.test.ts",
    "tests/e2e/review-file-through-mcp.test.ts"
  ]) {
    const target = join(workspace, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readText(join(sourceRoot, path)));
  }
  return workspace;
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}
