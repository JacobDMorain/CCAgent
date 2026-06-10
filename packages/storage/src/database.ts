import { createRequire } from "node:module";
import type {
  AutomationRunIterationRecord,
  AutomationRunProviderRecord,
  AutomationRunRecord,
  CodexEditTaskRecord,
  PromptTemplate
} from "@ccagent/core";

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
  readonly reviewBatches = new Map<string, StoredReviewBatchRow>();
  readonly reviewBatchTasks: StoredReviewBatchTaskRow[] = [];
  readonly promptTemplates = new Map<string, PromptTemplate>();
  readonly automationRuns = new Map<string, Omit<AutomationRunRecord, "providers" | "codexTask" | "iterations">>();
  readonly automationRunProviders: AutomationRunProviderRecord[] = [];
  readonly automationRunIterations: AutomationRunIterationRecord[] = [];
  readonly codexEditTasks = new Map<string, CodexEditTaskRecord>();
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

      CREATE TABLE IF NOT EXISTS review_batches (
        id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        file TEXT NOT NULL,
        review_style TEXT NOT NULL,
        language TEXT,
        started_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS review_batch_tasks (
        batch_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        task_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (batch_id, task_id)
      );

      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        required_variables_json TEXT NOT NULL,
        is_default INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS automation_runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        cwd TEXT NOT NULL,
        file TEXT NOT NULL,
        review_style TEXT NOT NULL,
        language TEXT,
        claude_template_id TEXT NOT NULL,
        codex_template_id TEXT NOT NULL,
        fully_auto INTEGER NOT NULL,
        max_iterations INTEGER NOT NULL DEFAULT 1,
        output_dir TEXT NOT NULL,
        review_packet_path TEXT,
        codex_prompt_path TEXT,
        codex_output_path TEXT,
        diff_path TEXT,
        final_report_path TEXT,
        error_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS automation_run_providers (
        run_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT,
        task_id TEXT,
        status TEXT NOT NULL,
        error_json TEXT,
        output_path TEXT,
        position INTEGER NOT NULL,
        PRIMARY KEY (run_id, provider)
      );

      CREATE TABLE IF NOT EXISTS codex_edit_tasks (
        run_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        prompt_path TEXT NOT NULL,
        output_path TEXT,
        error_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS automation_run_iterations (
        run_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        status TEXT NOT NULL,
        review_packet_path TEXT,
        codex_prompt_path TEXT,
        codex_output_path TEXT,
        diff_path TEXT,
        decision_summary_path TEXT,
        stop_decision_path TEXT,
        stop_reason TEXT,
        changes_detected INTEGER NOT NULL,
        continue_requested INTEGER,
        codex_continue_requested INTEGER,
        decision_confidence TEXT,
        next_focus_json TEXT,
        risk_flags_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        PRIMARY KEY (run_id, iteration)
      );
    `);
    try {
      this.handle.exec("ALTER TABLE automation_runs ADD COLUMN max_iterations INTEGER NOT NULL DEFAULT 1");
    } catch {
      // Column already exists on databases created after iterative automation support.
    }
    for (const sql of [
      "ALTER TABLE automation_run_iterations ADD COLUMN decision_confidence TEXT",
      "ALTER TABLE automation_run_iterations ADD COLUMN codex_continue_requested INTEGER",
      "ALTER TABLE automation_run_iterations ADD COLUMN next_focus_json TEXT",
      "ALTER TABLE automation_run_iterations ADD COLUMN risk_flags_json TEXT"
    ]) {
      try {
        this.handle.exec(sql);
      } catch {
        // Column already exists on databases created after Codex decision protocol support.
      }
    }
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

export interface StoredReviewBatchRow {
  id: string;
  cwd: string;
  file: string;
  reviewStyle: string;
  language?: string;
  startedAt: string;
}

export interface StoredReviewBatchTaskRow {
  batchId: string;
  provider: string;
  model?: string;
  taskId: string;
  position: number;
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
