import { describe, expect, test } from "vitest";
import { createBuiltInProviders } from "@ccagent/provider";
import { createDatabase, SqliteProviderStore } from "../src/index.js";

describe("SqliteProviderStore", () => {
  test("provider save/get/list/delete works without storing raw keys", () => {
    const database = createDatabase(":memory:");
    const store = new SqliteProviderStore(database);
    const provider = createBuiltInProviders().glm;

    store.saveProvider(provider);

    expect(store.getProvider("glm")).toMatchObject({
      id: "glm",
      apiKeyRef: "providers/glm/api-key"
    });
    expect(store.listProviders()).toHaveLength(1);

    store.deleteProvider("glm");

    expect(store.getProvider("glm")).toBeUndefined();
  });
});
