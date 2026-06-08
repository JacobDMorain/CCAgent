import { mkdirSync, copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dist = join(root, "dist", "windows");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const manifest = {
  name: "ccagent",
  platform: "windows",
  createdAt: new Date().toISOString(),
  entrypoints: {
    daemon: "apps/daemon/dist/apps/daemon/src/index.js",
    mcpServer: "apps/mcp-server/dist/apps/mcp-server/src/index.js",
    gui: "apps/gui/dist/main/index.js"
  },
  verification: [
    "pnpm typecheck",
    "pnpm test",
    "pnpm test:coverage",
    "pnpm build",
    "pnpm smoke:gui",
    "pnpm smoke:gui-dashboard",
    "pnpm acceptance:local-runtime",
    "pnpm acceptance:codex-mcp",
    "pnpm acceptance:real-providers",
    "pnpm acceptance:audit"
  ]
};

writeFileSync(join(dist, "manifest.json"), JSON.stringify(manifest, null, 2));

for (const doc of [
  "docs/codex-mcp-setup.md",
  "docs/provider-config.md",
  "docs/local-secrets.md",
  "docs/manual-evidence.example.json",
  "docs/release-checklist.md",
  "dist/acceptance/acceptance-audit.md",
  "dist/acceptance/acceptance-audit.json",
  "dist/acceptance/local-runtime-acceptance.json",
  "dist/acceptance/codex-mcp-acceptance.json",
  "dist/acceptance/real-provider-acceptance.json",
  "dist/acceptance/manual-evidence.json"
]) {
  const source = join(root, doc);
  if (existsSync(source)) {
    const target = join(dist, doc.replaceAll("/", "-"));
    copyFileSync(source, target);
  }
}

console.log(`Wrote Windows package manifest to ${dist}`);
