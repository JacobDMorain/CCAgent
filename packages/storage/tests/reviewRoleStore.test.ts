import { describe, expect, test } from "vitest";
import { createBuiltInReviewRoles } from "@ccagent/core";
import { createDatabase, SqliteReviewRoleStore } from "../src/index.js";

describe("SqliteReviewRoleStore", () => {
  test("review role save/get/list/delete works in memory storage", () => {
    const database = createDatabase(":memory:");
    const store = new SqliteReviewRoleStore(database);
    const role = createBuiltInReviewRoles("2026-06-10T10:00:00.000Z")[0];

    store.saveRole(role);

    expect(store.getRole("document-structure")).toMatchObject({
      id: "document-structure",
      group: "documentation-quality",
      name: "文档结构审查员",
      source: "global",
      defaultSelected: true
    });
    expect(store.listRoles()).toHaveLength(1);

    store.saveRole({
      ...role,
      defaultSelected: false,
      updatedAt: "2026-06-10T11:00:00.000Z"
    });

    expect(store.getRole("document-structure")?.defaultSelected).toBe(false);

    store.deleteRole("document-structure");

    expect(store.getRole("document-structure")).toBeUndefined();
  });
});
