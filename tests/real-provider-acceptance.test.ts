import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { readLocalConfigEnv, runRealProviderAcceptance } from "../scripts/real-provider-acceptance.js";

describe("real provider acceptance", () => {
  test("skips without real provider API keys", async () => {
    const root = workspaceRoot();
    const result = await runRealProviderAcceptance({
      root,
      env: {},
      now: () => "2026-06-05T00:00:00.000Z"
    });

    expect(result.status).toBe("skipped");
    expect(result.missingEnv).toEqual(["GLM_API_KEY", "DEEPSEEK_API_KEY"]);
    expect(existsSync(join(root, "dist", "acceptance", "real-provider-acceptance.json"))).toBe(true);
  });

  test("writes redacted report and partial manual evidence when injected provider runs pass", async () => {
    const root = workspaceRoot();
    const result = await runRealProviderAcceptance({
      root,
      env: {
        GLM_API_KEY: "sk-real-glm-secret",
        DEEPSEEK_API_KEY: "sk-real-deepseek-secret"
      },
      now: () => "2026-06-05T00:00:00.000Z",
      runProvider: async (spec, apiKey) => ({
        status: "passed",
        evidence: [`${spec.id} ran with key ${apiKey}`]
      })
    });

    expect(result.status).toBe("passed");
    const report = readFileSync(join(root, "dist", "acceptance", "real-provider-acceptance.json"), "utf8");
    expect(report).not.toContain("sk-real-glm-secret");
    expect(report).not.toContain("sk-real-deepseek-secret");
    expect(report).toContain("[REDACTED]");

    const manualEvidence = readFileSync(join(root, "dist", "acceptance", "manual-evidence.json"), "utf8");
    expect(manualEvidence).toContain("glm-real-provider");
    expect(manualEvidence).toContain("api-keys-redacted");
    expect(manualEvidence).not.toContain("sk-real-glm-secret");
  });

  test("loads API keys and provider URL overrides from local config document", async () => {
    const root = workspaceRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "ccagent.local-config.md"),
      [
        "# Local",
        "```dotenv",
        "GLM_API_KEY=sk-local-glm-secret",
        "DEEPSEEK_API_KEY=sk-local-deepseek-secret",
        "GLM_BASE_URL=https://ark.example.test/glm/v1",
        "DEEPSEEK_BASE_URL=https://deepseek.example.test",
        "```"
      ].join("\n")
    );

    expect(readLocalConfigEnv(root)).toMatchObject({
      GLM_API_KEY: "sk-local-glm-secret",
      DEEPSEEK_API_KEY: "sk-local-deepseek-secret",
      GLM_BASE_URL: "https://ark.example.test/glm/v1",
      DEEPSEEK_BASE_URL: "https://deepseek.example.test"
    });

    const seen: Record<string, string | undefined> = {};
    const result = await runRealProviderAcceptance({
      root,
      env: {},
      now: () => "2026-06-05T00:00:00.000Z",
      runProvider: async (spec, apiKey) => {
        seen[spec.id] = `${apiKey}|${spec.baseUrl}`;
        return {
          status: "passed",
          evidence: [`${spec.id} ran`]
        };
      }
    });

    expect(result.status).toBe("passed");
    expect(seen.glm).toBe("sk-local-glm-secret|https://ark.example.test/glm/v1");
    expect(seen.deepseek).toBe("sk-local-deepseek-secret|https://deepseek.example.test");
  });
});

function workspaceRoot(): string {
  return join(tmpdir(), `ccagent-real-provider-test-${Date.now()}-${Math.random()}`);
}
