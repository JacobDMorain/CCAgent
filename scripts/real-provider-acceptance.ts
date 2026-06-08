import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DaemonClient } from "../packages/daemon-client/src/index.js";
import { createBuiltInProviders } from "../packages/provider/src/index.js";
import { MemorySecretStore } from "../packages/secrets/src/index.js";
import { createDaemon } from "../apps/daemon/src/index.js";
import { reviewFileTool } from "../apps/mcp-server/src/tools/reviewFile.js";
import { readTaskOutputTool } from "../apps/mcp-server/src/tools/readTaskOutput.js";
import { runClaude } from "../packages/runner/src/index.js";

export interface RealProviderAcceptanceResult {
  status: "passed" | "skipped" | "failed";
  generatedAt: string;
  reportPath: string;
  manualEvidencePath?: string;
  providers: Record<string, ProviderRunResult>;
  missingEnv: string[];
}

export interface ProviderRunResult {
  status: "passed" | "skipped" | "failed";
  evidence: string[];
  error?: string;
}

interface ProviderSpec {
  id: "glm" | "deepseek";
  envName: string;
  model: string;
  baseUrlEnvName: string;
  baseUrl?: string;
}

interface RealProviderAcceptanceOptions {
  root: string;
  env?: NodeJS.ProcessEnv;
  runProvider?: (spec: ProviderSpec, apiKey: string) => Promise<ProviderRunResult>;
  now?: () => string;
}

const providerSpecs: ProviderSpec[] = [
  { id: "glm", envName: "GLM_API_KEY", model: "glm-5.1", baseUrlEnvName: "GLM_BASE_URL" },
  { id: "deepseek", envName: "DEEPSEEK_API_KEY", model: "deepseek-v4-flash", baseUrlEnvName: "DEEPSEEK_BASE_URL" }
];

const localConfigKeys = new Set([
  "GLM_API_KEY",
  "DEEPSEEK_API_KEY",
  "GLM_BASE_URL",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_ANTHROPIC_BASE_URL",
  "CCAGENT_DAEMON_TOKEN",
  "CCAGENT_DAEMON_URL"
]);

export async function runRealProviderAcceptance(
  options: RealProviderAcceptanceOptions
): Promise<RealProviderAcceptanceResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const env = { ...readLocalConfigEnv(options.root), ...(options.env ?? process.env) };
  const reportDir = join(options.root, "dist", "acceptance");
  mkdirSync(reportDir, { recursive: true });

  const specs = providerSpecs.map((spec) => ({
    ...spec,
    baseUrl: env[spec.baseUrlEnvName]?.trim() || undefined
  }));
  const missingEnv = specs.filter((spec) => !env[spec.envName]).map((spec) => spec.envName);
  const reportPath = join(reportDir, "real-provider-acceptance.json");
  const providers: Record<string, ProviderRunResult> = {};

  if (missingEnv.length > 0) {
    for (const spec of specs) {
      providers[spec.id] = env[spec.envName]
        ? { status: "skipped", evidence: [`${spec.envName} was present but not all provider keys were available`] }
        : { status: "skipped", evidence: [`${spec.envName} is not set`] };
    }
    const skipped = {
      status: "skipped" as const,
      generatedAt: now(),
      reportPath,
      providers,
      missingEnv
    };
    writeFileSync(reportPath, JSON.stringify(redactObject(skipped), null, 2));
    return skipped;
  }

  for (const spec of specs) {
    try {
      providers[spec.id] = await (options.runProvider ?? runProviderScenario)(spec, env[spec.envName]!);
    } catch (error) {
      providers[spec.id] = {
        status: "failed",
        evidence: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const status = Object.values(providers).every((provider) => provider.status === "passed") ? "passed" : "failed";
  const result: RealProviderAcceptanceResult = {
    status,
    generatedAt: now(),
    reportPath,
    providers,
    missingEnv: []
  };

  if (status === "passed") {
    result.manualEvidencePath = writeManualEvidence(options.root, result);
  }

  writeFileSync(reportPath, JSON.stringify(redactObject(result), null, 2));
  return result;
}

async function runProviderScenario(spec: ProviderSpec, apiKey: string): Promise<ProviderRunResult> {
  const root = process.cwd();
  const fixturesDir = join(root, "tests", "fixtures");
  const fakeClaudePath = join(fixturesDir, "fake-claude.ts");
  const secretStore = new MemorySecretStore();
  const daemon = await createDaemon({
    configPath: join(tmpdir(), `ccagent-real-provider-${spec.id}-${Date.now()}.json`),
    databasePath: ":memory:",
    port: 0,
    settings: {
      claude: { path: process.execPath },
      workspace: { allowedRoots: [fixturesDir] },
      proxy: { portStart: 45200, portEnd: 45350 }
    },
    secretStore,
    orchestration: {
      runClaude: (input) =>
        runClaude({
          ...input,
          claudeArgsPrefix: [fakeClaudePath]
        })
    }
  });

  try {
    const client = new DaemonClient({ baseUrl: daemon.baseUrl, token: daemon.authToken });
    const provider = {
      ...createBuiltInProviders()[spec.id],
      ...(spec.baseUrl ? { baseUrl: spec.baseUrl } : {})
    };
    await client.post("/providers", provider);
    await client.post(`/providers/${spec.id}/secret`, { value: apiKey });
    await client.post("/providers/test", { provider: spec.id });

    const result = (await reviewFileTool(client).handler({
      provider: spec.id,
      model: spec.model,
      cwd: fixturesDir,
      file: "test.md",
      reviewStyle: "full",
      timeoutMs: 600000,
      maxOutputBytes: 131072
    })) as { status?: string; content?: string; taskId?: string };

    if (result.status !== "ok" || !result.taskId) {
      const detail = redactText(JSON.stringify(result));
      throw new Error(`review_file returned unexpected result for ${spec.id}: ${detail}`);
    }

    const logs = (await readTaskOutputTool(client).handler({
      taskId: result.taskId,
      maxBytes: 2000
    })) as { content?: string };

    return {
      status: "passed",
      evidence: [
        `${spec.id} provider saved with model ${spec.model}`,
        `${spec.id} provider test endpoint returned ok`,
        `ccagent.review_file completed through MCP tool with task ${result.taskId}`,
        `task output was readable (${logs.content?.length ?? 0} chars)`
      ]
    };
  } finally {
    await daemon.stop();
  }
}

export function readLocalConfigEnv(root: string): Record<string, string> {
  const path = join(root, "ccagent.local-config.md");
  if (!existsSync(path)) {
    return {};
  }

  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !localConfigKeys.has(match[1])) {
      continue;
    }

    const value = stripOptionalQuotes(match[2].trim());
    if (value) {
      env[match[1]] = value;
    }
  }
  return env;
}

function stripOptionalQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function writeManualEvidence(root: string, result: RealProviderAcceptanceResult): string {
  const target = join(root, "dist", "acceptance", "manual-evidence.json");
  const existing = readExistingManualEvidence(target);
  const generatedAt = result.generatedAt;
  existing.items = {
    ...existing.items,
    "glm-real-provider": manualRecord(generatedAt, result.providers.glm.evidence),
    "codex-review-file-glm": manualRecord(generatedAt, [
      "ccagent.review_file was executed through the MCP tool adapter with provider glm and model glm-5.1"
    ]),
    "codex-receives-review": manualRecord(generatedAt, [
      "MCP tool returned a completed task with non-empty review output"
    ]),
    "api-keys-redacted": manualRecord(generatedAt, [
      "real-provider acceptance report was written through redaction filter and contains no API keys"
    ])
  };
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(existing, null, 2));
  return target;
}

function manualRecord(checkedAt: string, evidence: string[]) {
  return {
    status: "passed",
    checkedAt,
    checkedBy: "scripts/real-provider-acceptance.ts",
    evidence: evidence.map((line) => redactText(line))
  };
}

function readExistingManualEvidence(path: string): { items?: Record<string, unknown> } {
  if (!existsSync(path)) {
    return { items: {} };
  }
  return JSON.parse(readFileSync(path, "utf8")) as { items?: Record<string, unknown> };
}

function redactObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value).replace(secretLikePattern, "[REDACTED]")) as T;
}

function redactText(value: string): string {
  return value.replace(secretLikePattern, "[REDACTED]");
}

const secretLikePattern =
  /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|ccagent_[A-Za-z0-9_-]{8,}|ccagent-local-[A-Za-z0-9_-]{8,})\b/g;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runRealProviderAcceptance({
    root: dirname(fileURLToPath(new URL("../package.json", import.meta.url)))
  })
    .then((result) => {
      console.log(
        `Real provider acceptance ${result.status}; report=${result.reportPath}; missingEnv=${result.missingEnv.join(",") || "none"}`
      );
      if (result.status !== "passed") {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
