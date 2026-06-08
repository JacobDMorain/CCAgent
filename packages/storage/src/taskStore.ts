import { CCAgentError, ErrorCodes, type TaskStatus } from "@ccagent/core";
import type { StorageDatabase, StoredTaskRow } from "./database.js";

export interface CreateTaskInput {
  id: string;
  provider: string;
  model: string;
  cwd: string;
  prompt: string;
  startedAt: string;
}

export interface TaskRecord extends CreateTaskInput {
  status: TaskStatus;
  summary?: string;
  content?: string;
  errorJson?: string;
  finishedAt?: string;
  durationMs?: number;
}

export class SqliteTaskStore {
  constructor(private readonly database: StorageDatabase) {}

  createTask(input: CreateTaskInput): TaskRecord {
    const row: StoredTaskRow = {
      ...input,
      status: "pending"
    };
    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare(
          `INSERT INTO tasks
            (id, provider, model, cwd, status, prompt, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(row.id, row.provider, row.model, row.cwd, row.status, row.prompt, row.startedAt);
      return rowToRecord(row);
    }

    this.database.tasks.set(input.id, row);
    return rowToRecord(row);
  }

  updateTask(id: string, patch: Partial<TaskRecord>): void {
    if (this.database.kind === "sqlite") {
      const existing = this.getTask(id);
      if (!existing) {
        throw new CCAgentError(ErrorCodes.TaskMissing, `task missing: ${id}`);
      }
      const next = { ...existing, ...patch };
      this.database.handle
        .prepare(
          `UPDATE tasks SET
            provider = ?,
            model = ?,
            cwd = ?,
            status = ?,
            prompt = ?,
            summary = ?,
            content = ?,
            error_json = ?,
            started_at = ?,
            finished_at = ?,
            duration_ms = ?
           WHERE id = ?`
        )
        .run(
          next.provider,
          next.model,
          next.cwd,
          next.status,
          next.prompt,
          next.summary ?? null,
          next.content ?? null,
          next.errorJson ?? null,
          next.startedAt,
          next.finishedAt ?? null,
          next.durationMs ?? null,
          id
        );
      return;
    }

    const existing = this.database.tasks.get(id);
    if (!existing) {
      throw new CCAgentError(ErrorCodes.TaskMissing, `task missing: ${id}`);
    }

    this.database.tasks.set(id, {
      ...existing,
      ...patch
    });
  }

  appendLog(taskId: string, stream: "stdout" | "stderr" | "system", text: string): void {
    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare("INSERT INTO task_logs (task_id, ts, stream, text) VALUES (?, ?, ?, ?)")
        .run(taskId, new Date().toISOString(), stream, text);
      return;
    }

    this.database.logs.push({
      taskId,
      stream,
      text,
      ts: new Date().toISOString()
    });
  }

  getTask(id: string): TaskRecord | undefined {
    if (this.database.kind === "sqlite") {
      const row = this.database.handle
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .get(id) as SqliteTaskRow | undefined;
      return row ? sqliteRowToRecord(row) : undefined;
    }

    const row = this.database.tasks.get(id);
    return row ? rowToRecord(row) : undefined;
  }

  cancelTask(id: string): TaskRecord {
    this.updateTask(id, {
      status: "cancelled",
      finishedAt: new Date().toISOString()
    });
    const task = this.getTask(id);
    if (!task) {
      throw new CCAgentError(ErrorCodes.TaskMissing, `task missing: ${id}`);
    }
    return task;
  }

  readOutput(id: string, maxBytes: number): { content: string; truncated: boolean } {
    const content = this.getTask(id)?.content ?? "";
    return truncate(content, maxBytes);
  }

  readLogs(taskId: string, maxBytes: number): { content: string; truncated: boolean } {
    if (this.database.kind === "sqlite") {
      const content = this.database.handle
        .prepare("SELECT stream, text FROM task_logs WHERE task_id = ? ORDER BY ts")
        .all(taskId)
        .map((log) => `${(log as { stream: string }).stream}: ${(log as { text: string }).text}`)
        .join("\n");
      return truncate(content, maxBytes);
    }

    const content = this.database.logs
      .filter((log) => log.taskId === taskId)
      .map((log) => `${log.stream}: ${log.text}`)
      .join("\n");
    return truncate(content, maxBytes);
  }

  listTasks(limit: number): TaskRecord[] {
    if (this.database.kind === "sqlite") {
      return this.database.handle
        .prepare("SELECT * FROM tasks ORDER BY started_at DESC LIMIT ?")
        .all(limit)
        .map((row) => sqliteRowToRecord(row as SqliteTaskRow));
    }

    return [...this.database.tasks.values()].slice(0, limit).map(rowToRecord);
  }
}

interface SqliteTaskRow {
  id: string;
  provider: string;
  model: string;
  cwd: string;
  status: string;
  prompt: string;
  summary: string | null;
  content: string | null;
  error_json: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
}

function rowToRecord(row: StoredTaskRow): TaskRecord {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    cwd: row.cwd,
    prompt: row.prompt,
    status: row.status as TaskStatus,
    summary: row.summary,
    content: row.content,
    errorJson: row.errorJson,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs
  };
}

function sqliteRowToRecord(row: SqliteTaskRow): TaskRecord {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    cwd: row.cwd,
    prompt: row.prompt,
    status: row.status as TaskStatus,
    summary: row.summary ?? undefined,
    content: row.content ?? undefined,
    errorJson: row.error_json ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
    durationMs: row.duration_ms ?? undefined
  };
}

function truncate(content: string, maxBytes: number): { content: string; truncated: boolean } {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) {
    return { content, truncated: false };
  }

  return { content: content.slice(0, maxBytes), truncated: true };
}
