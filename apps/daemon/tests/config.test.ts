import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vitest";
import { loadSettingsFromFile } from "../src/config.js";

describe("daemon config", () => {
  test("loads UTF-8 BOM prefixed JSON config files", () => {
    const dir = mkdtempSync(join(tmpdir(), "ccagent-config-"));
    const configPath = join(dir, "config.json");
    try {
      writeFileSync(
        configPath,
        "\ufeff" +
          JSON.stringify({
            workspace: {
              allowedRoots: ["D:/project"]
            }
          }),
        "utf8"
      );

      expect(loadSettingsFromFile(configPath)).toEqual({
        workspace: {
          allowedRoots: ["D:/project"]
        }
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
