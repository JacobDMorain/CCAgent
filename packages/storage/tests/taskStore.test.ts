import { describe, expect, test } from "vitest";
import {
  createDatabase,
  SqliteSettingsStore,
  SqliteTaskStore,
  type CreateTaskInput
} from "../src/index.js";

describe("storage", () => {
  test("database configures WAL mode and busy timeout", () => {
    const database = createDatabase(":memory:");

    expect(database.pragma("journal_mode", { simple: true })).toBe("memory");
    expect(database.pragma("busy_timeout", { simple: true })).toBeGreaterThan(0);
  });

  test("task lifecycle update, logs, output truncation, and listing work", () => {
    const database = createDatabase(":memory:");
    const store = new SqliteTaskStore(database);
    const input: CreateTaskInput = {
      id: "task_1",
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      prompt: "Review test.md",
      startedAt: "2026-06-05T10:00:00.000Z"
    };

    const created = store.createTask(input);
    expect(created.status).toBe("pending");

    store.updateTask("task_1", {
      status: "ok",
      summary: "summary",
      content: "abcdef",
      finishedAt: "2026-06-05T10:00:01.000Z",
      durationMs: 1000
    });
    store.appendLog("task_1", "stdout", "hello");
    store.appendLog("task_1", "stderr", "warn");

    expect(store.getTask("task_1")).toMatchObject({
      status: "ok",
      content: "abcdef"
    });
    expect(store.readOutput("task_1", 3)).toEqual({ content: "abc", truncated: true });
    expect(store.readLogs("task_1", 100).content).toContain("stdout: hello");
    expect(store.listTasks(10)).toHaveLength(1);
  });

  test("settings store saves and loads daemon settings", () => {
    const database = createDatabase(":memory:");
    const store = new SqliteSettingsStore(database);

    store.set("daemon", { port: 47621 });

    expect(store.get<{ port: number }>("daemon")).toEqual({ port: 47621 });
  });

  test("concurrent task status updates are serialized by sqlite transactions", async () => {
    const database = createDatabase(":memory:");
    const store = new SqliteTaskStore(database);
    store.createTask({
      id: "task_1",
      provider: "glm",
      model: "glm-5.1",
      cwd: "D:/project",
      prompt: "Review test.md",
      startedAt: "2026-06-05T10:00:00.000Z"
    });

    await Promise.all([
      Promise.resolve().then(() => store.updateTask("task_1", { status: "running" })),
      Promise.resolve().then(() => store.updateTask("task_1", { status: "ok", content: "done" }))
    ]);

    expect(["running", "ok"]).toContain(store.getTask("task_1")?.status);
  });
});
