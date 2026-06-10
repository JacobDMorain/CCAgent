import { describe, expect, test } from "vitest";
import {
  createDatabase,
  SqliteAutomationRunStore,
  SqlitePromptTemplateStore
} from "../src/index.js";

describe("automation run storage", () => {
  test("prompt template CRUD works in memory storage", () => {
    const database = createDatabase(":memory:");
    const store = new SqlitePromptTemplateStore(database);
    const template = {
      id: "default-codex-edit",
      kind: "codex-edit" as const,
      name: "Codex edit",
      description: "Edit from packet",
      version: 1,
      content: "Read {reviewPacket}",
      requiredVariables: ["reviewPacket"],
      isDefault: true,
      createdAt: "2026-06-08T10:00:00.000Z",
      updatedAt: "2026-06-08T10:00:00.000Z"
    };

    store.saveTemplate(template);

    expect(store.listTemplates()).toEqual([template]);
    expect(store.getTemplate("default-codex-edit")).toEqual(template);

    store.saveTemplate({ ...template, name: "Updated", version: 2 });
    expect(store.getTemplate("default-codex-edit")).toMatchObject({ name: "Updated", version: 2 });

    store.deleteTemplate("default-codex-edit");
    expect(store.listTemplates()).toEqual([]);
  });

  test("automation run create, provider update, and codex task update works in memory storage", () => {
    const database = createDatabase(":memory:");
    const store = new SqliteAutomationRunStore(database);

    store.createRun({
      id: "run_1",
      status: "queued",
      cwd: "D:/project",
      file: "docs/handoff.md",
      reviewStyle: "full",
      claudeTemplateId: "default-claude-review-full",
      codexTemplateId: "default-codex-edit",
      fullyAuto: true,
      maxIterations: 2,
      outputDir: "D:/project/.ccagent/runs/run_1",
      createdAt: "2026-06-08T10:00:00.000Z",
      updatedAt: "2026-06-08T10:00:00.000Z",
      providers: [
        {
          runId: "run_1",
          provider: "glm",
          model: "glm-5.1",
          status: "queued",
          position: 0
        }
      ],
      iterations: []
    });

    store.updateRun("run_1", {
      status: "reviewing",
      updatedAt: "2026-06-08T10:00:01.000Z"
    });
    store.updateProvider("run_1", "glm", {
      status: "succeeded",
      taskId: "task_1",
      outputPath: "D:/project/.ccagent/runs/run_1/providers/glm/output.md"
    });
    store.upsertCodexTask({
      runId: "run_1",
      taskId: "codex_1",
      status: "running",
      promptPath: "D:/project/.ccagent/runs/run_1/codex-prompt.md",
      startedAt: "2026-06-08T10:00:02.000Z"
    });
    store.upsertIteration({
      runId: "run_1",
      iteration: 1,
      status: "completed",
      reviewPacketPath: "D:/project/.ccagent/runs/run_1/iterations/iteration-001/review-packet.md",
      diffPath: "D:/project/.ccagent/runs/run_1/iterations/iteration-001/diff.patch",
      stopReason: "continuing after document changes",
      changesDetected: true,
      continueRequested: true,
      codexContinueRequested: true,
      decisionConfidence: "medium",
      nextFocus: ["Check whether the updated milestone labels are consistent"],
      riskFlags: ["summary-diff-mismatch"],
      startedAt: "2026-06-08T10:00:03.000Z",
      finishedAt: "2026-06-08T10:00:04.000Z"
    });

    expect(store.getRun("run_1")).toMatchObject({
      id: "run_1",
      status: "reviewing",
      maxIterations: 2,
      providers: [{ provider: "glm", status: "succeeded", taskId: "task_1" }],
      codexTask: { taskId: "codex_1", status: "running" },
      iterations: [{
        iteration: 1,
        status: "completed",
        changesDetected: true,
        continueRequested: true,
        codexContinueRequested: true,
        decisionConfidence: "medium",
        nextFocus: ["Check whether the updated milestone labels are consistent"],
        riskFlags: ["summary-diff-mismatch"]
      }]
    });
    expect(store.listRuns(10)).toHaveLength(1);

    store.deleteRun("run_1");

    expect(store.getRun("run_1")).toBeUndefined();
    expect(store.listRuns(10)).toHaveLength(0);
  });
});
