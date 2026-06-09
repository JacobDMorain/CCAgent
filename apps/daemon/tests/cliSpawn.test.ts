import { describe, expect, test } from "vitest";
import { spawnCli } from "../src/cliSpawn.js";

describe("spawnCli", () => {
  test("can run the current Node executable", async () => {
    const child = spawnCli(process.execPath, ["--version"], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^v\d+\./);
  });
});
