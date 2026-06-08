import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { createBuiltInProviders } from "@ccagent/provider";
import {
  createDatabase,
  SqliteProviderStore,
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
    first.close();

    const second = createDatabase(dbPath);
    const reopenedProviders = new SqliteProviderStore(second);
    const reopenedSettings = new SqliteSettingsStore(second);
    const reopenedTasks = new SqliteTaskStore(second);

    expect(reopenedProviders.getProvider("glm")).toMatchObject({ id: "glm" });
    expect(reopenedSettings.get<{ port: number }>("daemon")).toEqual({ port: 47621 });
    expect(reopenedTasks.getTask("task_persist")).toMatchObject({
      status: "ok",
      content: "persisted output"
    });
    expect(reopenedTasks.readLogs("task_persist", 1000).content).toContain("persisted log");
    second.close();
  });
});

function tempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), "ccagent-storage-"));
  tempDirs.push(dir);
  return join(dir, "ccagent.db");
}
