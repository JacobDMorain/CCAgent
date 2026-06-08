import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDaemon } from "../apps/daemon/src/index.js";
import { MemorySecretStore } from "../packages/secrets/src/index.js";

export interface LocalRuntimeAcceptanceResult {
  status: "passed" | "failed";
  generatedAt: string;
  reportPath: string;
  manualEvidencePath?: string;
  checks: {
    daemon: LocalCheck;
    gui: LocalCheck;
    guiDashboard: LocalCheck;
    claudeSettings: LocalCheck;
  };
}

interface LocalCheck {
  status: "passed" | "failed";
  evidence: string[];
  error?: string;
}

interface LocalRuntimeAcceptanceOptions {
  root: string;
  now?: () => string;
  runGuiSmoke?: () => Promise<string>;
  runGuiDashboardSmoke?: () => Promise<string>;
  claudeSettingsPath?: string;
}

interface FileSnapshot {
  exists: boolean;
  mtimeMs?: number;
  sha256?: string;
}

export async function runLocalRuntimeAcceptance(
  options: LocalRuntimeAcceptanceOptions
): Promise<LocalRuntimeAcceptanceResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const reportDir = join(options.root, "dist", "acceptance");
  mkdirSync(reportDir, { recursive: true });
  const reportPath = join(reportDir, "local-runtime-acceptance.json");

  const beforeSettings = snapshotFile(options.claudeSettingsPath ?? defaultClaudeSettingsPath());
  const checks = {
    daemon: await checkDaemon(options.root),
    gui: await checkGui(options.runGuiSmoke ?? (() => runCommand("pnpm.cmd", ["smoke:gui"], options.root))),
    guiDashboard: await checkGui(
      options.runGuiDashboardSmoke ?? (() => runCommand("pnpm.cmd", ["smoke:gui-dashboard"], options.root))
    ),
    claudeSettings: checkClaudeSettings(beforeSettings, options.claudeSettingsPath ?? defaultClaudeSettingsPath())
  };

  const status = Object.values(checks).every((check) => check.status === "passed") ? "passed" : "failed";
  const result: LocalRuntimeAcceptanceResult = {
    status,
    generatedAt: now(),
    reportPath,
    checks
  };

  if (status === "passed") {
    result.manualEvidencePath = writeManualEvidence(options.root, result);
  }

  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  return result;
}

async function checkDaemon(root: string): Promise<LocalCheck> {
  const daemon = await createDaemon({
    configPath: join(tmpdir(), `ccagent-local-runtime-${Date.now()}.json`),
    databasePath: ":memory:",
    port: 0,
    settings: {
      workspace: { allowedRoots: [root] }
    },
    secretStore: new MemorySecretStore()
  });

  try {
    const response = await fetch(`${daemon.baseUrl}/health`);
    const body = (await response.json()) as { status?: string };
    if (!response.ok || body.status !== "ok") {
      return {
        status: "failed",
        evidence: [],
        error: `GET /health returned ${response.status}`
      };
    }
    return {
      status: "passed",
      evidence: [`daemon started at ${daemon.baseUrl}`, "GET /health returned ok"]
    };
  } catch (error) {
    return {
      status: "failed",
      evidence: [],
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await daemon.stop();
  }
}

async function checkGui(runGuiSmoke: () => Promise<string>): Promise<LocalCheck> {
  try {
    const output = await runGuiSmoke();
    return {
      status: "passed",
      evidence: ["pnpm smoke:gui completed", firstLine(output)]
    };
  } catch (error) {
    return {
      status: "failed",
      evidence: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function checkClaudeSettings(before: FileSnapshot, path: string): LocalCheck {
  const after = snapshotFile(path);
  if (before.exists !== after.exists || before.mtimeMs !== after.mtimeMs || before.sha256 !== after.sha256) {
    return {
      status: "failed",
      evidence: [],
      error: `${path} changed during local runtime acceptance`
    };
  }

  return {
    status: "passed",
    evidence: before.exists
      ? [`${path} existed and hash stayed ${before.sha256}`]
      : [`${path} did not exist before or after local runtime acceptance`]
  };
}

function writeManualEvidence(root: string, result: LocalRuntimeAcceptanceResult): string {
  const target = join(root, "dist", "acceptance", "manual-evidence.json");
  const existing = readExistingManualEvidence(target);
  existing.items = {
    ...existing.items,
    "daemon-starts": manualRecord(result.generatedAt, result.checks.daemon.evidence),
    "gui-starts": manualRecord(result.generatedAt, result.checks.gui.evidence),
    "gui-dashboard-completed-task": manualRecord(result.generatedAt, result.checks.guiDashboard.evidence),
    "global-claude-settings-untouched": manualRecord(result.generatedAt, result.checks.claudeSettings.evidence)
  };
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(existing, null, 2));
  return target;
}

function manualRecord(checkedAt: string, evidence: string[]) {
  return {
    status: "passed",
    checkedAt,
    checkedBy: "scripts/local-runtime-acceptance.ts",
    evidence
  };
}

function readExistingManualEvidence(path: string): { items?: Record<string, unknown> } {
  if (!existsSync(path)) {
    return { items: {} };
  }
  return JSON.parse(readFileSync(path, "utf8")) as { items?: Record<string, unknown> };
}

function snapshotFile(path: string): FileSnapshot {
  if (!existsSync(path)) {
    return { exists: false };
  }
  const stat = statSync(path);
  const sha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  return { exists: true, mtimeMs: stat.mtimeMs, sha256 };
}

function defaultClaudeSettingsPath(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? process.cwd();
  return join(home, ".claude", "settings.json");
}

function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", command, ...args], { cwd, windowsHide: true })
        : spawn(command, args, { cwd, shell: false, windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}\n${output}`));
      }
    });
  });
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.slice(0, 160) ?? "no output";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runLocalRuntimeAcceptance({
    root: dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
  })
    .then((result) => {
      console.log(`Local runtime acceptance ${result.status}; report=${result.reportPath}`);
      if (result.status !== "passed") {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
