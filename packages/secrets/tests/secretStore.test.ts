import { describe, expect, test } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ErrorCodes } from "@ccagent/core";
import { DpapiStore, MemorySecretStore } from "../src/index.js";

describe("MemorySecretStore", () => {
  test("set/get/delete works", async () => {
    const store = new MemorySecretStore();

    await store.set("providers/glm/api-key", "sk-testabcd");

    await expect(store.get("providers/glm/api-key")).resolves.toBe("sk-testabcd");
    await expect(store.has("providers/glm/api-key")).resolves.toBe(true);

    await store.delete("providers/glm/api-key");

    await expect(store.has("providers/glm/api-key")).resolves.toBe(false);
  });

  test("fingerprint masks values", async () => {
    const store = new MemorySecretStore();
    await store.set("providers/glm/api-key", "sk-1234567890abcd");

    await expect(store.fingerprint("providers/glm/api-key")).resolves.toBe("sk-...abcd");
  });

  test("missing key throws structured error", async () => {
    const store = new MemorySecretStore();

    await expect(store.get("missing")).rejects.toMatchObject({
      code: ErrorCodes.SecretMissing
    });
  });
});

describe("DpapiStore", () => {
  test("persists encrypted secrets across instances", async () => {
    const filePath = join(tmpdir(), `ccagent-secrets-${Date.now()}.json`);
    try {
      const first = new DpapiStore(filePath);
      await first.set("providers/glm/api-key", "sk-secret-value");

      const raw = await first.readRawForTests();
      expect(raw).toContain("providers/glm/api-key");
      expect(raw).not.toContain("sk-secret-value");

      const second = new DpapiStore(filePath);
      await expect(second.get("providers/glm/api-key")).resolves.toBe("sk-secret-value");
      expect(second.getSync("providers/glm/api-key")).toBe("sk-secret-value");
      await expect(second.fingerprint("providers/glm/api-key")).resolves.toBe("sk-...alue");
    } finally {
      rmSync(filePath, { force: true });
    }
  });
});
