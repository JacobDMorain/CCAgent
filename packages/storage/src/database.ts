import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface CCAgentDatabase {
  pragma(name: string, options?: { simple?: boolean }): unknown;
  close(): void;
}

export class MemoryDatabase implements CCAgentDatabase {
  readonly kind = "memory";
  readonly providers = new Map<string, string>();
  readonly settings = new Map<string, string>();
  readonly tasks = new Map<string, StoredTaskRow>();
  readonly logs: StoredTaskLogRow[] = [];
  private readonly pragmas = new Map<string, unknown>([
    ["journal_mode", "memory"],
    ["busy_timeout", 5000]
  ]);

  pragma(name: string, options?: { simple?: boolean }): unknown {
    const value = this.pragmas.get(name);
    return options?.simple ? value : [{ [name]: value }];
  }

  close(): void {
    // In-memory test database has no external handle.
  }
}

export class SqliteDatabase implements CCAgentDatabase {
  readonly kind = "sqlite";
  readonly handle: DatabaseSyncLike;

  constructor(path: string) {
    const { DatabaseSync } = loadNodeSqlite();
    this.handle = new DatabaseSync(path);
    this.handle.exec("PRAGMA journal_mode = WAL");
    this.handle.exec("PRAGMA busy_timeout = 5000");
    this.migrate();
  }

  pragma(name: string, options?: { simple?: boolean }): unknown {
    const row = this.handle.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
    if (options?.simple) {
      return row ? Object.values(row)[0] : undefined;
    }
    return row ? [row] : [];
  }

  close(): void {
    this.handle.close();
  }

  private migrate(): void {
    this.handle.exec(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        summary TEXT,
        content TEXT,
        error_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS task_logs (
        task_id TEXT NOT NULL,
        ts TEXT NOT NULL,
        stream TEXT NOT NULL,
        text TEXT NOT NULL
      );
    `);
  }
}

export interface StoredTaskRow {
  id: string;
  provider: string;
  model: string;
  cwd: string;
  status: string;
  prompt: string;
  summary?: string;
  content?: string;
  errorJson?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface StoredTaskLogRow {
  taskId: string;
  ts: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export type StorageDatabase = MemoryDatabase | SqliteDatabase;

export function createDatabase(path: string): StorageDatabase {
  return path === ":memory:" ? new MemoryDatabase() : new SqliteDatabase(path);
}

interface DatabaseSyncConstructor {
  new (path: string): DatabaseSyncLike;
}

interface DatabaseSyncLike {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): StatementSyncLike;
}

interface StatementSyncLike {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

function loadNodeSqlite(): { DatabaseSync: DatabaseSyncConstructor } {
  return require("node:sqlite") as { DatabaseSync: DatabaseSyncConstructor };
}
