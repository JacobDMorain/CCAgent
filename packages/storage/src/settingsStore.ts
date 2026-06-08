import type { StorageDatabase } from "./database.js";

export class SqliteSettingsStore {
  constructor(private readonly database: StorageDatabase) {}

  set<T>(key: string, value: T): void {
    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare("INSERT OR REPLACE INTO settings (key, json) VALUES (?, ?)")
        .run(key, JSON.stringify(value));
      return;
    }

    this.database.settings.set(key, JSON.stringify(value));
  }

  get<T>(key: string): T | undefined {
    if (this.database.kind === "sqlite") {
      const row = this.database.handle
        .prepare("SELECT json FROM settings WHERE key = ?")
        .get(key) as { json: string } | undefined;
      return row ? (JSON.parse(row.json) as T) : undefined;
    }

    const value = this.database.settings.get(key);
    return value ? (JSON.parse(value) as T) : undefined;
  }
}
