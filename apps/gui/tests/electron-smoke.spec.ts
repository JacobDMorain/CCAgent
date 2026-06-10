import { test, expect, _electron as electron } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = join(__dirname, "..", "dist", "main", "index.js");

test("Electron GUI opens built renderer shell", async () => {
  const app = await electron.launch({
    args: [entry]
  });

  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "CCAgent" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^(Review Workspace|评审工作区)$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^(Providers|服务商)$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^(Tasks|任务)$/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^(Settings|设置)$/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /^(Workspace root|工作区根目录)$/ })).toBeVisible();
  } finally {
    await app.close();
  }
});
