import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { createBuiltInProviders } from "@ccagent/provider";
import {
  createDatabase,
  SqliteAutomationRunStore,
  SqliteProviderStore,
  SqlitePromptTemplateStore,
  SqliteReviewBatchStore,
  SqliteSettingsStore,
  SqliteTaskStore
} from "../src/index.js";

const tempDirs: string[] = [];

describe("SQLite persistence", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("providers, settings, tasks, and logs persist across database reopen", () => {
    const dbPath = tempDatabasePath();
    const first = createDatabase(dbPath);
    const providers = new SqliteProviderStore(first);
    const settings = new SqliteSettingsStore(first);
    const tasks = new SqliteTaskStore(first);
    const batches = new SqliteReviewBatchStore(first);
    const templates = new SqlitePromptTemplateStore(first);
    const runs = new SqliteAutomationRunStore(first);

    providers.saveProvider(createBuiltInProviders().glm);
    settings.set("daemon", { port: 47621 });
    tasks.createTask({
      id: "task_persist",
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      prompt: "Review test.md",
      startedAt: "2026-06-05T10:00:00.000Z"
    });
    tasks.updateTask("task_persist", {
      status: "ok",
      content: "persisted output",
      summary: "persisted summary",
      finishedAt: "2026-06-05T10:00:01.000Z",
      durationMs: 1000
    });
    tasks.appendLog("task_persist", "stdout", "persisted log");
    batches.createBatch({
      id: "batch_persist",
      cwd: "D:/project",
      file: "test.md",
      reviewStyle: "bugs",
      startedAt: "2026-06-08T10:00:00.000Z",
      tasks: [{ provider: "glm", model: "glm-5.1", taskId: "task_persist", position: 0 }]
    });
    templates.saveTemplate({
      id: "template_persist",
      kind: "codex-edit",
      name: "Persisted template",
      description: "Persisted template",
      version: 1,
      content: "Read {reviewPacket}",
      requiredVariables: ["reviewPacket"],
      isDefault: true,
      createdAt: "2026-06-08T10:00:00.000Z",
      updatedAt: "2026-06-08T10:00:00.000Z"
    });
    runs.createRun({
      id: "run_persist",
      status: "done",
      cwd: "D:/project",
      file: "test.md",
      reviewStyle: "full",
      claudeTemplateId: "default-claude-review-full",
      codexTemplateId: "default-codex-edit",
      fullyAuto: true,
      maxIterations: 3,
      outputDir: "D:/project/.ccagent/runs/run_persist",
      reviewPacketPath: "D:/project/.ccagent/runs/run_persist/review-packet.md",
      createdAt: "2026-06-08T10:00:00.000Z",
      updatedAt: "2026-06-08T10:00:01.000Z",
      finishedAt: "2026-06-08T10:00:01.000Z",
      providers: [
        {
          runId: "run_persist",
          provider: "glm",
          model: "glm-5.1",
          taskId: "task_persist",
          status: "succeeded",
          startedAt: "2026-06-08T10:00:00.000Z",
          finishedAt: "2026-06-08T10:00:01.000Z",
          position: 0
        }
      ],
      iterations: []
    });
    runs.upsertIteration({
      runId: "run_persist",
      iteration: 1,
      status: "stopped",
      reviewPacketPath: "D:/project/.ccagent/runs/run_persist/iterations/iteration-001/review-packet.md",
      decisionSummaryPath: "D:/project/.ccagent/runs/run_persist/iterations/iteration-001/codex-decision-summary.md",
      stopReason: "Codex reported no actionable findings",
      changesDetected: false,
      continueRequested: false,
      codexContinueRequested: false,
      decisionConfidence: "high",
      nextFocus: ["No follow-up review needed"],
      riskFlags: [],
      startedAt: "2026-06-08T10:00:00.000Z",
      finishedAt: "2026-06-08T10:00:01.000Z"
    });
    first.close();

    const second = createDatabase(dbPath);
    const reopenedProviders = new SqliteProviderStore(second);
    const reopenedSettings = new SqliteSettingsStore(second);
    const reopenedTasks = new SqliteTaskStore(second);
    const reopenedBatches = new SqliteReviewBatchStore(second);
    const reopenedTemplates = new SqlitePromptTemplateStore(second);
    const reopenedRuns = new SqliteAutomationRunStore(second);

    expect(reopenedProviders.getProvider("glm")).toMatchObject({ id: "glm" });
    expect(reopenedSettings.get<{ port: number }>("daemon")).toEqual({ port: 47621 });
    expect(reopenedTasks.getTask("task_persist")).toMatchObject({
      status: "ok",
      content: "persisted output"
    });
    expect(reopenedTasks.readLogs("task_persist", 1000).content).toContain("persisted log");
    expect(reopenedBatches.getBatch("batch_persist")).toMatchObject({
      id: "batch_persist",
      file: "test.md",
      tasks: [{ provider: "glm", model: "glm-5.1", taskId: "task_persist", position: 0 }]
    });
    expect(reopenedTemplates.getTemplate("template_persist")).toMatchObject({
      id: "template_persist",
      requiredVariables: ["reviewPacket"]
    });
    expect(reopenedRuns.getRun("run_persist")).toMatchObject({
      id: "run_persist",
      status: "done",
      maxIterations: 3,
      providers: [{
        provider: "glm",
        taskId: "task_persist",
        status: "succeeded",
        startedAt: "2026-06-08T10:00:00.000Z",
        finishedAt: "2026-06-08T10:00:01.000Z"
      }],
      iterations: [{
        iteration: 1,
        status: "stopped",
        stopReason: "Codex reported no actionable findings",
        decisionConfidence: "high",
        codexContinueRequested: false,
        nextFocus: ["No follow-up review needed"],
        riskFlags: []
      }]
    });
    second.close();
  });
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "ccagent-storage-"));
  tempDirs.push(dir);
  return join(dir, "ccagent.db");
}
