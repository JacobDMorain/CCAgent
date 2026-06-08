import { test, expect, _electron as electron } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createDatabase, SqliteTaskStore } from "@ccagent/storage";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = join(__dirname, "..", "dist", "main", "index.js");

test("Electron GUI task dashboard shows a completed task from daemon", async () => {
  const appData = mkdtempSync(join(tmpdir(), "ccagent-gui-dashboard-"));
  mkdirSync(join(appData, "CCAgent"), { recursive: true });
  const taskId = "task_dashboard_acceptance";
  const database = createDatabase(join(appData, "CCAgent", "ccagent.sqlite"));
  const taskStore = new SqliteTaskStore(database);
  const startedAt = new Date().toISOString();

  try {
    taskStore.createTask({
      id: taskId,
      provider: "glm",
      model: "glm-4.5",
      cwd: "D:/project",
      prompt: "complete dashboard task",
      startedAt
    });
    taskStore.updateTask(taskId, {
      status: "ok",
      summary: "dashboard task completed",
      content: "dashboard review result",
      finishedAt: new Date(Date.parse(startedAt) + 25).toISOString(),
      durationMs: 25
    });
    taskStore.appendLog(taskId, "stdout", "dashboard task completed");
  } finally {
    database.close();
  }

  const app = await electron.launch({
    args: [entry],
    env: {
      ...process.env,
      APPDATA: appData,
      CCAGENT_DAEMON_URL: undefined,
      CCAGENT_DAEMON_TOKEN: undefined
    }
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    const hasGuiApi = await page.evaluate(() => Boolean(window.ccagent));
    expect(hasGuiApi).toBe(true);
    await expect(page.getByText(taskId)).toBeVisible();
    await expect(page.getByText("dashboard review result")).toBeVisible();
    await expect(page.locator("tr", { hasText: taskId })).toContainText("ok");
  } finally {
    await app.close();
  }
});
