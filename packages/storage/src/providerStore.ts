import type { ProviderConfig } from "@ccagent/core";
import type { StorageDatabase } from "./database.js";

export class SqliteProviderStore {
  constructor(private readonly database: StorageDatabase) {}

  saveProvider(provider: ProviderConfig): void {
    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare("INSERT OR REPLACE INTO providers (id, json) VALUES (?, ?)")
        .run(provider.id, JSON.stringify(provider));
      return;
    }

    this.database.providers.set(provider.id, JSON.stringify(provider));
  }

  getProvider(id: string): ProviderConfig | undefined {
    if (this.database.kind === "sqlite") {
      const row = this.database.handle
        .prepare("SELECT json FROM providers WHERE id = ?")
        .get(id) as { json: string } | undefined;
      return row ? (JSON.parse(row.json) as ProviderConfig) : undefined;
    }

    const json = this.database.providers.get(id);
    return json ? (JSON.parse(json) as ProviderConfig) : undefined;
  }

  listProviders(): ProviderConfig[] {
    if (this.database.kind === "sqlite") {
      return this.database.handle
        .prepare("SELECT json FROM providers ORDER BY id")
        .all()
        .map((row) => JSON.parse((row as { json: string }).json) as ProviderConfig);
    }

    return [...this.database.providers.values()].map((json) => JSON.parse(json) as ProviderConfig);
  }

  deleteProvider(id: string): void {
    if (this.database.kind === "sqlite") {
      this.database.handle.prepare("DELETE FROM providers WHERE id = ?").run(id);
      return;
    }

    this.database.providers.delete(id);
  }
}
