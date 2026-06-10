import type { ReviewRole } from "@ccagent/core";
import type { StorageDatabase } from "./database.js";

export class SqliteReviewRoleStore {
  constructor(private readonly database: StorageDatabase) {}

  saveRole(role: ReviewRole): ReviewRole {
    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare(
          `INSERT OR REPLACE INTO review_roles (id, json, created_at, updated_at)
           VALUES (?, ?, ?, ?)`
        )
        .run(role.id, JSON.stringify(role), role.createdAt, role.updatedAt);
      return cloneRole(role);
    }

    this.database.reviewRoles.set(role.id, cloneRole(role));
    return cloneRole(role);
  }

  getRole(id: string): ReviewRole | undefined {
    if (this.database.kind === "sqlite") {
      const row = this.database.handle
        .prepare("SELECT json FROM review_roles WHERE id = ?")
        .get(id) as { json: string } | undefined;
      return row ? (JSON.parse(row.json) as ReviewRole) : undefined;
    }

    const role = this.database.reviewRoles.get(id);
    return role ? cloneRole(role) : undefined;
  }

  listRoles(): ReviewRole[] {
    if (this.database.kind === "sqlite") {
      return sortRoles(this.database.handle
        .prepare("SELECT json FROM review_roles ORDER BY id")
        .all()
        .map((row) => JSON.parse((row as { json: string }).json) as ReviewRole));
    }

    return sortRoles([...this.database.reviewRoles.values()].map(cloneRole));
  }

  deleteRole(id: string): void {
    if (this.database.kind === "sqlite") {
      this.database.handle.prepare("DELETE FROM review_roles WHERE id = ?").run(id);
      return;
    }

    this.database.reviewRoles.delete(id);
  }
}

const builtInRoleOrder = [
  "document-structure",
  "fact-consistency",
  "actionability",
  "risk-opposition",
  "language-expression"
];

function sortRoles(roles: ReviewRole[]): ReviewRole[] {
  return roles.sort((left, right) => {
    const leftOrder = builtInRoleOrder.indexOf(left.id);
    const rightOrder = builtInRoleOrder.indexOf(right.id);
    if (leftOrder !== -1 || rightOrder !== -1) {
      return (leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder)
        - (rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder);
    }
    return left.id.localeCompare(right.id);
  });
}

function cloneRole(role: ReviewRole): ReviewRole {
  return {
    ...role,
    focusAreas: [...role.focusAreas]
  };
}
