import type {
  AutomationRunProviderRecord,
  AutomationRunRecord,
  CodexEditTaskRecord
} from "@ccagent/core";
import type { StorageDatabase } from "./database.js";

export type CreateAutomationRunInput = AutomationRunRecord;

export class SqliteAutomationRunStore {
  constructor(private readonly database: StorageDatabase) {}

  createRun(input: CreateAutomationRunInput): AutomationRunRecord {
    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare(
          `INSERT INTO automation_runs
            (id, status, cwd, file, review_style, language, claude_template_id, codex_template_id,
             fully_auto, output_dir, review_packet_path, codex_prompt_path, codex_output_path,
             diff_path, final_report_path, error_json, created_at, updated_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.id,
          input.status,
          input.cwd,
          input.file,
          input.reviewStyle,
          input.language ?? null,
          input.claudeTemplateId,
          input.codexTemplateId,
          input.fullyAuto ? 1 : 0,
          input.outputDir,
          input.reviewPacketPath ?? null,
          input.codexPromptPath ?? null,
          input.codexOutputPath ?? null,
          input.diffPath ?? null,
          input.finalReportPath ?? null,
          input.errorJson ?? null,
          input.createdAt,
          input.updatedAt,
          input.finishedAt ?? null
        );
      for (const provider of input.providers) {
        this.insertProvider(provider);
      }
      if (input.codexTask) {
        this.upsertCodexTask(input.codexTask);
      }
      return cloneRun(input);
    }

    const { providers: _providers, codexTask: _codexTask, ...run } = input;
    this.database.automationRuns.set(input.id, { ...run });
    this.database.automationRunProviders.push(...input.providers.map(cloneProvider));
    if (input.codexTask) {
      this.database.codexEditTasks.set(input.id, { ...input.codexTask });
    }
    return cloneRun(input);
  }

  updateRun(id: string, patch: Partial<Omit<AutomationRunRecord, "id" | "providers" | "codexTask">>): void {
    const existing = this.getRun(id);
    if (!existing) {
      throw new Error(`automation run missing: ${id}`);
    }
    const next = { ...existing, ...patch, providers: existing.providers, codexTask: existing.codexTask };

    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare(
          `UPDATE automation_runs SET
            status = ?,
            cwd = ?,
            file = ?,
            review_style = ?,
            language = ?,
            claude_template_id = ?,
            codex_template_id = ?,
            fully_auto = ?,
            output_dir = ?,
            review_packet_path = ?,
            codex_prompt_path = ?,
            codex_output_path = ?,
            diff_path = ?,
            final_report_path = ?,
            error_json = ?,
            created_at = ?,
            updated_at = ?,
            finished_at = ?
           WHERE id = ?`
        )
        .run(
          next.status,
          next.cwd,
          next.file,
          next.reviewStyle,
          next.language ?? null,
          next.claudeTemplateId,
          next.codexTemplateId,
          next.fullyAuto ? 1 : 0,
          next.outputDir,
          next.reviewPacketPath ?? null,
          next.codexPromptPath ?? null,
          next.codexOutputPath ?? null,
          next.diffPath ?? null,
          next.finalReportPath ?? null,
          next.errorJson ?? null,
          next.createdAt,
          next.updatedAt,
          next.finishedAt ?? null,
          id
        );
      return;
    }

    const { providers: _providers, codexTask: _codexTask, ...run } = next;
    this.database.automationRuns.set(id, { ...run });
  }

  updateProvider(runId: string, provider: string, patch: Partial<AutomationRunProviderRecord>): void {
    if (this.database.kind === "sqlite") {
      const existing = this.getRun(runId)?.providers.find((item) => item.provider === provider);
      if (!existing) {
        throw new Error(`automation run provider missing: ${runId}/${provider}`);
      }
      this.insertProvider({ ...existing, ...patch, runId, provider });
      return;
    }

    const index = this.database.automationRunProviders.findIndex(
      (item) => item.runId === runId && item.provider === provider
    );
    if (index === -1) {
      throw new Error(`automation run provider missing: ${runId}/${provider}`);
    }
    this.database.automationRunProviders[index] = {
      ...this.database.automationRunProviders[index],
      ...patch,
      runId,
      provider
    };
  }

  upsertCodexTask(task: CodexEditTaskRecord): void {
    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare(
          `INSERT INTO codex_edit_tasks
            (run_id, task_id, status, prompt_path, output_path, error_json, started_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(run_id) DO UPDATE SET
            task_id = excluded.task_id,
            status = excluded.status,
            prompt_path = excluded.prompt_path,
            output_path = excluded.output_path,
            error_json = excluded.error_json,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at`
        )
        .run(
          task.runId,
          task.taskId,
          task.status,
          task.promptPath,
          task.outputPath ?? null,
          task.errorJson ?? null,
          task.startedAt,
          task.finishedAt ?? null
        );
      return;
    }

    this.database.codexEditTasks.set(task.runId, { ...task });
  }

  getRun(id: string): AutomationRunRecord | undefined {
    if (this.database.kind === "sqlite") {
      const row = this.database.handle
        .prepare("SELECT * FROM automation_runs WHERE id = ?")
        .get(id) as SqliteAutomationRunRow | undefined;
      return row ? this.rowToRun(row) : undefined;
    }

    const run = this.database.automationRuns.get(id);
    if (!run) {
      return undefined;
    }
    return cloneRun({
      ...run,
      providers: this.database.automationRunProviders
        .filter((provider) => provider.runId === id)
        .sort((left, right) => left.position - right.position)
        .map(cloneProvider),
      codexTask: this.database.codexEditTasks.get(id)
    });
  }

  listRuns(limit: number): AutomationRunRecord[] {
    if (this.database.kind === "sqlite") {
      return this.database.handle
        .prepare("SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT ?")
        .all(limit)
        .map((row) => this.rowToRun(row as SqliteAutomationRunRow));
    }

    return [...this.database.automationRuns.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((run) => this.getRun(run.id))
      .filter((run): run is AutomationRunRecord => Boolean(run));
  }

  deleteRun(id: string): void {
    if (this.database.kind === "sqlite") {
      this.database.handle.prepare("DELETE FROM codex_edit_tasks WHERE run_id = ?").run(id);
      this.database.handle.prepare("DELETE FROM automation_run_providers WHERE run_id = ?").run(id);
      this.database.handle.prepare("DELETE FROM automation_runs WHERE id = ?").run(id);
      return;
    }

    this.database.codexEditTasks.delete(id);
    const providers = this.database.automationRunProviders;
    for (let index = providers.length - 1; index >= 0; index -= 1) {
      if (providers[index].runId === id) {
        providers.splice(index, 1);
      }
    }
    this.database.automationRuns.delete(id);
  }

  private insertProvider(provider: AutomationRunProviderRecord): void {
    if (this.database.kind !== "sqlite") {
      return;
    }
    this.database.handle
      .prepare(
        `INSERT INTO automation_run_providers
          (run_id, provider, model, task_id, status, error_json, output_path, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, provider) DO UPDATE SET
          model = excluded.model,
          task_id = excluded.task_id,
          status = excluded.status,
          error_json = excluded.error_json,
          output_path = excluded.output_path,
          position = excluded.position`
      )
      .run(
        provider.runId,
        provider.provider,
        provider.model ?? null,
        provider.taskId ?? null,
        provider.status,
        provider.errorJson ?? null,
        provider.outputPath ?? null,
        provider.position
      );
  }

  private rowToRun(row: SqliteAutomationRunRow): AutomationRunRecord {
    if (this.database.kind !== "sqlite") {
      throw new Error("rowToRun requires sqlite storage");
    }
    const providers = this.database.handle
      .prepare("SELECT * FROM automation_run_providers WHERE run_id = ? ORDER BY position ASC")
      .all(row.id)
      .map((provider: unknown) => sqliteProviderToRecord(provider as SqliteAutomationRunProviderRow));
    const codexTask = this.database.handle
      .prepare("SELECT * FROM codex_edit_tasks WHERE run_id = ?")
      .get(row.id) as SqliteCodexEditTaskRow | undefined;

    return {
      id: row.id,
      status: row.status as AutomationRunRecord["status"],
      cwd: row.cwd,
      file: row.file,
      reviewStyle: row.review_style as AutomationRunRecord["reviewStyle"],
      language: row.language ?? undefined,
      claudeTemplateId: row.claude_template_id,
      codexTemplateId: row.codex_template_id,
      fullyAuto: row.fully_auto === 1,
      outputDir: row.output_dir,
      reviewPacketPath: row.review_packet_path ?? undefined,
      codexPromptPath: row.codex_prompt_path ?? undefined,
      codexOutputPath: row.codex_output_path ?? undefined,
      diffPath: row.diff_path ?? undefined,
      finalReportPath: row.final_report_path ?? undefined,
      errorJson: row.error_json ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      finishedAt: row.finished_at ?? undefined,
      providers,
      codexTask: codexTask ? sqliteCodexTaskToRecord(codexTask) : undefined
    };
  }
}

interface SqliteAutomationRunRow {
  id: string;
  status: string;
  cwd: string;
  file: string;
  review_style: string;
  language: string | null;
  claude_template_id: string;
  codex_template_id: string;
  fully_auto: number;
  output_dir: string;
  review_packet_path: string | null;
  codex_prompt_path: string | null;
  codex_output_path: string | null;
  diff_path: string | null;
  final_report_path: string | null;
  error_json: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

interface SqliteAutomationRunProviderRow {
  run_id: string;
  provider: string;
  model: string | null;
  task_id: string | null;
  status: string;
  error_json: string | null;
  output_path: string | null;
  position: number;
}

interface SqliteCodexEditTaskRow {
  run_id: string;
  task_id: string;
  status: string;
  prompt_path: string;
  output_path: string | null;
  error_json: string | null;
  started_at: string;
  finished_at: string | null;
}

function sqliteProviderToRecord(row: SqliteAutomationRunProviderRow): AutomationRunProviderRecord {
  return {
    runId: row.run_id,
    provider: row.provider,
    model: row.model ?? undefined,
    taskId: row.task_id ?? undefined,
    status: row.status as AutomationRunProviderRecord["status"],
    errorJson: row.error_json ?? undefined,
    outputPath: row.output_path ?? undefined,
    position: row.position
  };
}

function sqliteCodexTaskToRecord(row: SqliteCodexEditTaskRow): CodexEditTaskRecord {
  return {
    runId: row.run_id,
    taskId: row.task_id,
    status: row.status as CodexEditTaskRecord["status"],
    promptPath: row.prompt_path,
    outputPath: row.output_path ?? undefined,
    errorJson: row.error_json ?? undefined,
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined
  };
}

function cloneRun(run: AutomationRunRecord): AutomationRunRecord {
  return {
    ...run,
    providers: run.providers.map(cloneProvider),
    codexTask: run.codexTask ? { ...run.codexTask } : undefined
  };
}

function cloneProvider(provider: AutomationRunProviderRecord): AutomationRunProviderRecord {
  return { ...provider };
}
