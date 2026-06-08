import { describe, expect, test } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("GUI smoke artifacts", () => {
  test("Electron entry, preload, renderer shell, and key route files exist", () => {
    const root = join(process.cwd(), "apps/gui/src");

    for (const file of [
      "main/index.ts",
      "main/preload.cts",
      "renderer/index.html",
      "renderer/main.tsx",
      "renderer/App.tsx",
      "renderer/routes/ProvidersPage.tsx",
      "renderer/routes/TasksPage.tsx",
      "renderer/components/ProviderForm.tsx",
      "renderer/components/TaskTable.tsx"
    ]) {
      expect(existsSync(join(root, file))).toBe(true);
    }
  });

  test("production build includes bundled renderer assets", () => {
    const rendererDist = join(process.cwd(), "apps/gui/dist/renderer");

    expect(existsSync(join(rendererDist, "index.html"))).toBe(true);
    expect(readdirSync(join(rendererDist, "assets")).some((file) => file.endsWith(".js"))).toBe(true);
    expect(readdirSync(join(rendererDist, "assets")).some((file) => file.endsWith(".css"))).toBe(true);
  });
});
