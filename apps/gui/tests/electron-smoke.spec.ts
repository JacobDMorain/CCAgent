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
    await expect(page.getByRole("heading", { name: "Review Workspace" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Workspace root" })).toBeVisible();
  } finally {
    await app.close();
  }
});
