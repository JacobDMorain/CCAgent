import type {
  StorageDatabase,
  StoredReviewBatchRow,
  StoredReviewBatchTaskRow
} from "./database.js";

export interface ReviewBatchTaskRecord {
  provider: string;
  model?: string;
  taskId: string;
  position: number;
}

export interface CreateReviewBatchInput {
  id: string;
  cwd: string;
  file: string;
  reviewStyle: string;
  language?: string;
  startedAt: string;
  tasks: ReviewBatchTaskRecord[];
}

export interface ReviewBatchRecord extends CreateReviewBatchInput {}

export class SqliteReviewBatchStore {
  constructor(private readonly database: StorageDatabase) {}

  createBatch(input: CreateReviewBatchInput): ReviewBatchRecord {
    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare(
          `INSERT INTO review_batches
            (id, cwd, file, review_style, language, started_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.id,
          input.cwd,
          input.file,
          input.reviewStyle,
          input.language ?? null,
          input.startedAt
        );
      const insertTask = this.database.handle.prepare(
        `INSERT INTO review_batch_tasks
          (batch_id, provider, model, task_id, position)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const task of input.tasks) {
        insertTask.run(input.id, task.provider, task.model ?? null, task.taskId, task.position);
      }
      return normalizeBatch(input);
    }

    this.database.reviewBatches.set(input.id, {
      id: input.id,
      cwd: input.cwd,
      file: input.file,
      reviewStyle: input.reviewStyle,
      language: input.language,
      startedAt: input.startedAt
    });
    this.database.reviewBatchTasks.push(
      ...input.tasks.map((task) => ({
        batchId: input.id,
        provider: task.provider,
        model: task.model,
        taskId: task.taskId,
        position: task.position
      }))
    );
    return normalizeBatch(input);
  }

  getBatch(id: string): ReviewBatchRecord | undefined {
    if (this.database.kind === "sqlite") {
      const batch = this.database.handle
        .prepare("SELECT * FROM review_batches WHERE id = ?")
        .get(id) as SqliteReviewBatchRow | undefined;
      if (!batch) {
        return undefined;
      }
      const tasks = this.database.handle
        .prepare("SELECT * FROM review_batch_tasks WHERE batch_id = ? ORDER BY position ASC")
        .all(id)
        .map((row) => sqliteTaskRowToRecord(row as SqliteReviewBatchTaskRow));
      return {
        id: batch.id,
        cwd: batch.cwd,
        file: batch.file,
        reviewStyle: batch.review_style,
        language: batch.language ?? undefined,
        startedAt: batch.started_at,
        tasks
      };
    }

    const batch = this.database.reviewBatches.get(id);
    if (!batch) {
      return undefined;
    }
    return {
      id: batch.id,
      cwd: batch.cwd,
      file: batch.file,
      reviewStyle: batch.reviewStyle,
      language: batch.language,
      startedAt: batch.startedAt,
      tasks: this.database.reviewBatchTasks
        .filter((task) => task.batchId === id)
        .sort((left, right) => left.position - right.position)
        .map(memoryTaskRowToRecord)
    };
  }
}

interface SqliteReviewBatchRow {
  id: string;
  cwd: string;
  file: string;
  review_style: string;
  language: string | null;
  started_at: string;
}

interface SqliteReviewBatchTaskRow {
  batch_id: string;
  provider: string;
  model: string | null;
  task_id: string;
  position: number;
}

function normalizeBatch(input: CreateReviewBatchInput): ReviewBatchRecord {
  return {
    ...input,
    tasks: input.tasks.map((task) => ({ ...task }))
  };
}

function sqliteTaskRowToRecord(row: SqliteReviewBatchTaskRow): ReviewBatchTaskRecord {
  return {
    provider: row.provider,
    model: row.model ?? undefined,
    taskId: row.task_id,
    position: row.position
  };
}

function memoryTaskRowToRecord(row: StoredReviewBatchTaskRow): ReviewBatchTaskRecord {
  return {
    provider: row.provider,
    model: row.model,
    taskId: row.taskId,
    position: row.position
  };
}

export type { StoredReviewBatchRow, StoredReviewBatchTaskRow };
