import type {
  AutomationRunIterationRecord,
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
             fully_auto, max_iterations, output_dir, review_packet_path, codex_prompt_path, codex_output_path,
             diff_path, final_report_path, error_json, created_at, updated_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          input.maxIterations,
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

    const { providers: _providers, codexTask: _codexTask, iterations: _iterations, ...run } = input;
    this.database.automationRuns.set(input.id, { ...run });
    this.database.automationRunProviders.push(...input.providers.map(cloneProvider));
    if (input.codexTask) {
      this.database.codexEditTasks.set(input.id, { ...input.codexTask });
    }
    this.database.automationRunIterations.push(...input.iterations.map(cloneIteration));
    return cloneRun(input);
  }

  updateRun(id: string, patch: Partial<Omit<AutomationRunRecord, "id" | "providers" | "codexTask" | "iterations">>): void {
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
            max_iterations = ?,
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
          next.maxIterations,
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

    const { providers: _providers, codexTask: _codexTask, iterations: _iterations, ...run } = next;
    this.database.automationRuns.set(id, { ...run });
  }

  upsertIteration(iteration: AutomationRunIterationRecord): void {
    if (this.database.kind === "sqlite") {
      this.database.handle
        .prepare(
          `INSERT INTO automation_run_iterations
            (run_id, iteration, status, review_packet_path, codex_prompt_path, codex_output_path,
             diff_path, decision_summary_path, stop_decision_path, stop_reason, changes_detected,
             continue_requested, codex_continue_requested, decision_confidence, next_focus_json,
             risk_flags_json, started_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(run_id, iteration) DO UPDATE SET
            status = excluded.status,
            review_packet_path = excluded.review_packet_path,
            codex_prompt_path = excluded.codex_prompt_path,
            codex_output_path = excluded.codex_output_path,
            diff_path = excluded.diff_path,
            decision_summary_path = excluded.decision_summary_path,
            stop_decision_path = excluded.stop_decision_path,
            stop_reason = excluded.stop_reason,
            changes_detected = excluded.changes_detected,
            continue_requested = excluded.continue_requested,
            codex_continue_requested = excluded.codex_continue_requested,
            decision_confidence = excluded.decision_confidence,
            next_focus_json = excluded.next_focus_json,
            risk_flags_json = excluded.risk_flags_json,
            started_at = excluded.started_at,
            finished_at = excluded.finished_at`
        )
        .run(
          iteration.runId,
          iteration.iteration,
          iteration.status,
          iteration.reviewPacketPath ?? null,
          iteration.codexPromptPath ?? null,
          iteration.codexOutputPath ?? null,
          iteration.diffPath ?? null,
          iteration.decisionSummaryPath ?? null,
          iteration.stopDecisionPath ?? null,
          iteration.stopReason ?? null,
          iteration.changesDetected ? 1 : 0,
          iteration.continueRequested === undefined ? null : iteration.continueRequested ? 1 : 0,
          iteration.codexContinueRequested === undefined ? null : iteration.codexContinueRequested ? 1 : 0,
          iteration.decisionConfidence ?? null,
          iteration.nextFocus ? JSON.stringify(iteration.nextFocus) : null,
          iteration.riskFlags ? JSON.stringify(iteration.riskFlags) : null,
          iteration.startedAt,
          iteration.finishedAt ?? null
        );
      return;
    }

    const index = this.database.automationRunIterations.findIndex(
      (item) => item.runId === iteration.runId && item.iteration === iteration.iteration
    );
    if (index === -1) {
      this.database.automationRunIterations.push(cloneIteration(iteration));
      return;
    }
    this.database.automationRunIterations[index] = cloneIteration(iteration);
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
      codexTask: this.database.codexEditTasks.get(id),
      iterations: this.database.automationRunIterations
        .filter((iteration) => iteration.runId === id)
        .sort((left, right) => left.iteration - right.iteration)
        .map(cloneIteration)
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
      this.database.handle.prepare("DELETE FROM automation_run_iterations WHERE run_id = ?").run(id);
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
    const iterations = this.database.automationRunIterations;
    for (let index = iterations.length - 1; index >= 0; index -= 1) {
      if (iterations[index].runId === id) {
        iterations.splice(index, 1);
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
          (run_id, provider, model, role_ids_json, task_id, status, error_json, output_path, started_at, finished_at, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, provider) DO UPDATE SET
          model = excluded.model,
          role_ids_json = excluded.role_ids_json,
          task_id = excluded.task_id,
          status = excluded.status,
          error_json = excluded.error_json,
          output_path = excluded.output_path,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          position = excluded.position`
      )
      .run(
        provider.runId,
        provider.provider,
        provider.model ?? null,
        provider.roleIds ? JSON.stringify(provider.roleIds) : null,
        provider.taskId ?? null,
        provider.status,
        provider.errorJson ?? null,
        provider.outputPath ?? null,
        provider.startedAt ?? null,
        provider.finishedAt ?? null,
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
    const iterations = this.database.handle
      .prepare("SELECT * FROM automation_run_iterations WHERE run_id = ? ORDER BY iteration ASC")
      .all(row.id)
      .map((iteration: unknown) => sqliteIterationToRecord(iteration as SqliteAutomationRunIterationRow));

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
      maxIterations: row.max_iterations,
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
      codexTask: codexTask ? sqliteCodexTaskToRecord(codexTask) : undefined,
      iterations
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
  max_iterations: number;
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

interface SqliteAutomationRunIterationRow {
  run_id: string;
  iteration: number;
  status: string;
  review_packet_path: string | null;
  codex_prompt_path: string | null;
  codex_output_path: string | null;
  diff_path: string | null;
  decision_summary_path: string | null;
  stop_decision_path: string | null;
  stop_reason: string | null;
  changes_detected: number;
  continue_requested: number | null;
  codex_continue_requested: number | null;
  decision_confidence: string | null;
  next_focus_json: string | null;
  risk_flags_json: string | null;
  started_at: string;
  finished_at: string | null;
}

interface SqliteAutomationRunProviderRow {
  run_id: string;
  provider: string;
  model: string | null;
  role_ids_json: string | null;
  task_id: string | null;
  status: string;
  error_json: string | null;
  output_path: string | null;
  started_at: string | null;
  finished_at: string | null;
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
    roleIds: parseStringArray(row.role_ids_json),
    taskId: row.task_id ?? undefined,
    status: row.status as AutomationRunProviderRecord["status"],
    errorJson: row.error_json ?? undefined,
    outputPath: row.output_path ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
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

function sqliteIterationToRecord(row: SqliteAutomationRunIterationRow): AutomationRunIterationRecord {
  return {
    runId: row.run_id,
    iteration: row.iteration,
    status: row.status as AutomationRunIterationRecord["status"],
    reviewPacketPath: row.review_packet_path ?? undefined,
    codexPromptPath: row.codex_prompt_path ?? undefined,
    codexOutputPath: row.codex_output_path ?? undefined,
    diffPath: row.diff_path ?? undefined,
    decisionSummaryPath: row.decision_summary_path ?? undefined,
    stopDecisionPath: row.stop_decision_path ?? undefined,
    stopReason: row.stop_reason ?? undefined,
    changesDetected: row.changes_detected === 1,
    continueRequested: row.continue_requested === null ? undefined : row.continue_requested === 1,
    codexContinueRequested: row.codex_continue_requested === null ? undefined : row.codex_continue_requested === 1,
    decisionConfidence: parseConfidence(row.decision_confidence),
    nextFocus: parseStringArray(row.next_focus_json),
    riskFlags: parseStringArray(row.risk_flags_json),
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined
  };
}

function parseConfidence(value: string | null): AutomationRunIterationRecord["decisionConfidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function parseStringArray(value: string | null): string[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : undefined;
  } catch {
    return undefined;
  }
}

function cloneRun(run: AutomationRunRecord): AutomationRunRecord {
  return {
    ...run,
    providers: run.providers.map(cloneProvider),
    codexTask: run.codexTask ? { ...run.codexTask } : undefined,
    iterations: run.iterations.map(cloneIteration)
  };
}

function cloneProvider(provider: AutomationRunProviderRecord): AutomationRunProviderRecord {
  return { ...provider, roleIds: provider.roleIds ? [...provider.roleIds] : undefined };
}

function cloneIteration(iteration: AutomationRunIterationRecord): AutomationRunIterationRecord {
  return { ...iteration };
}
