import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseDelimitedLocalConfigValue,
  parseExternalProviderConsent,
  parseLocalOperatorConfig
} from "../packages/provider/src/index.js";

export type AcceptanceStatus = "automated" | "manual-required" | "manual-verified" | "missing";

export interface AcceptanceItem {
  id: string;
  requirement: string;
  status: AcceptanceStatus;
  evidence: string[];
}

export interface AcceptanceAudit {
  generatedAt: string;
  readyForRelease: boolean;
  summary: Record<AcceptanceStatus, number>;
  items: AcceptanceItem[];
}

interface ItemSpec {
  id: string;
  requirement: string;
  evidence: EvidenceSpec[];
  manual?: boolean;
}

interface EvidenceSpec {
  file: string;
  contains?: string[];
}

interface ManualEvidenceFile {
  items?: Record<string, ManualEvidenceRecord>;
}

interface ManualEvidenceRecord {
  status?: string;
  checkedAt?: string;
  checkedBy?: string;
  evidence?: string[];
}

const finalAcceptance: ItemSpec[] = [
  {
    id: "daemon-starts",
    requirement: "Start CCAgent daemon.",
    manual: true,
    evidence: [
      { file: "apps/daemon/src/index.ts", contains: ["createDaemon", "import.meta.url"] },
      { file: "apps/daemon/tests/daemon-api.test.ts", contains: ["/health works without token"] }
    ]
  },
  {
    id: "gui-starts",
    requirement: "Start CCAgent GUI.",
    manual: true,
    evidence: [
      { file: "apps/gui/tests/electron-smoke.spec.ts", contains: ["Electron GUI opens built renderer shell"] },
      { file: "package.json", contains: ["smoke:gui"] }
    ]
  },
  {
    id: "glm-real-provider",
    requirement: "Configure GLM provider with API key and model glm-5.1.",
    manual: true,
    evidence: [
      { file: "packages/provider/src/providerConfig.ts", contains: ["glm-5.1", "open.bigmodel.cn"] },
      { file: "docs/provider-config.md", contains: ["GLM", "glm-5.1"] }
    ]
  },
  {
    id: "codex-mcp-registration",
    requirement: "Register CCAgent MCP server in Codex.",
    manual: true,
    evidence: [
      {
        file: "docs/codex-mcp-setup.md",
        contains: ["Register the MCP server", "apps/mcp-server/dist/apps/mcp-server/src/index.js"]
      }
    ]
  },
  {
    id: "codex-review-file-glm",
    requirement: "In Codex, call ccagent.review_file with GLM on test.md.",
    manual: true,
    evidence: [
      { file: "tests/e2e/review-file-through-mcp.test.ts", contains: ["ccagent.review_file", "glm-5.1", "test.md"] }
    ]
  },
  {
    id: "codex-receives-review",
    requirement: "Confirm Codex receives review text.",
    manual: true,
    evidence: [
      {
        file: "tests/e2e/review-file-through-mcp.test.ts",
        contains: ["Fake review result for test.md", "result.content"]
      }
    ]
  },
  {
    id: "gui-dashboard-completed-task",
    requirement: "Confirm GUI task dashboard shows the completed task.",
    manual: true,
    evidence: [
      { file: "apps/gui/src/renderer/App.tsx", contains: ["listTasks"] },
      { file: "apps/gui/src/renderer/components/TaskTable.tsx", contains: ["task.status", "task.content"] },
      { file: "apps/gui/tests/electron-dashboard.spec.ts", contains: ["dashboard review result"] }
    ]
  },
  {
    id: "global-claude-settings-untouched",
    requirement: "Confirm no global Claude Code settings file was modified.",
    manual: true,
    evidence: [
      { file: "apps/daemon/src/taskManager.ts", contains: ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"] },
      { file: "docs/release-checklist.md", contains: ["global Claude Code settings file"] }
    ]
  },
  {
    id: "deepseek-while-glm-running",
    requirement: "Start another task with DeepSeek while GLM task is running.",
    evidence: [
      {
        file: "tests/e2e/concurrent-providers.test.ts",
        contains: ["slow task", "deepseek", "fast task"]
      }
    ]
  },
  {
    id: "independent-task-completion",
    requirement: "Confirm both tasks finish independently.",
    evidence: [
      {
        file: "tests/e2e/concurrent-providers.test.ts",
        contains: ["status: \"ok\"", "status: \"cancelled\"", "fast.taskId"]
      }
    ]
  },
  {
    id: "cancel-selected-task-only",
    requirement: "Confirm task cancellation kills only the selected task.",
    evidence: [
      {
        file: "tests/e2e/concurrent-providers.test.ts",
        contains: ["/cancel", "does not cancel the other"]
      }
    ]
  },
  {
    id: "logs-readable",
    requirement: "Confirm task logs are readable after completion.",
    evidence: [
      {
        file: "tests/e2e/concurrent-providers.test.ts",
        contains: ["/logs?maxBytes=1000", "stdout: completed"]
      },
      { file: "tests/e2e/review-file-through-mcp.test.ts", contains: ["ccagent.read_task_output"] }
    ]
  },
  {
    id: "api-keys-redacted",
    requirement: "Confirm API keys are not visible in MCP output, GUI output, or logs.",
    evidence: [
      {
        file: "tests/e2e/review-file-through-mcp.test.ts",
        contains: [
          "redacts API keys from MCP output, GUI task data, and daemon logs",
          "not.toContain(apiKey)",
          "not.toContain(\"ccagent-local-\")"
        ]
      },
      {
        file: "apps/daemon/src/taskManager.ts",
        contains: ["createTaskRedactor", "secretLikePattern", "[REDACTED]"]
      },
      { file: "apps/gui/tests/gui-renderer.test.tsx", contains: ["not.toContain(\"sk-real-secret\")"] },
      { file: "packages/secrets/tests/secretStore.test.ts", contains: ["not.toContain(\"sk-secret-value\")"] }
    ]
  },
  {
    id: "path-policy",
    requirement: "Confirm path policy rejects files outside allowed roots.",
    evidence: [
      { file: "apps/daemon/tests/daemon-api.test.ts", contains: ["PathDenied"] },
      { file: "packages/core/tests/pathPolicy.test.ts", contains: ["path policy"] }
    ]
  },
  {
    id: "startup-recovery",
    requirement: "Confirm daemon startup recovery marks orphaned running tasks as errored.",
    evidence: [
      {
        file: "tests/e2e/concurrent-providers.test.ts",
        contains: ["startup recovery marks persisted running tasks as error", "DaemonRecovered"]
      }
    ]
  },
  {
    id: "max-concurrent-limit",
    requirement: "Confirm max concurrent task limit is enforced.",
    evidence: [
      { file: "apps/daemon/tests/daemon-api.test.ts", contains: ["maxConcurrentTasks", "CCAGENT_TASK_LIMIT"] }
    ]
  },
  {
    id: "proxy-port-exhaustion",
    requirement: "Confirm proxy port exhaustion returns a structured error.",
    evidence: [
      { file: "packages/proxy/tests/portAllocator.test.ts", contains: ["ProxyPortUnavailable"] }
    ]
  },
  {
    id: "provider-url-verification",
    requirement: "Confirm GLM and DeepSeek provider template URLs were verified before release.",
    evidence: [
      {
        file: "docs/provider-config.md",
        contains: ["Verified on 2026-06-05", "open.bigmodel.cn", "api.deepseek.com"]
      }
    ]
  },
  {
    id: "local-egress-policy",
    requirement: "Record local allowed roots and external provider consent without exposing secrets.",
    evidence: [
      { file: "docs/local-secrets.md", contains: ["CCAGENT_ALLOWED_ROOTS", "CCAGENT_EXTERNAL_PROVIDER_CONSENT"] },
      {
        file: "packages/provider/tests/providerRegistry.test.ts",
        contains: ["CCAGENT_ALLOWED_ROOTS", "CCAGENT_EXTERNAL_PROVIDER_CONSENT"]
      }
    ]
  },
  {
    id: "gui-automation-run",
    requirement: "Run GUI-hosted end-to-end automation from multi-provider review to Codex edit output.",
    evidence: [
      {
        file: "apps/daemon/src/automationManager.ts",
        contains: ["createRun", "writeReviewPacket", "runCodexPhase"]
      },
      {
        file: "apps/daemon/tests/daemon-api.test.ts",
        contains: ["automation run completes multi-provider review", "automation run continues to codex"]
      },
      {
        file: "apps/gui/src/renderer/routes/ReviewWorkspacePage.tsx",
        contains: ["Start fully automatic run", "claudeTemplateId", "codexTemplateId"]
      },
      {
        file: "apps/gui/src/renderer/routes/RunsPage.tsx",
        contains: ["Rerun", "providerSummary"]
      },
      {
        file: "apps/gui/src/renderer/App.tsx",
        contains: ["Codex CLI path", "saveRuntimeSettings"]
      }
    ]
  }
];

export function buildAcceptanceAudit(root: string, generatedAt = new Date().toISOString()): AcceptanceAudit {
  const manualEvidence = readManualEvidence(root);
  const items = finalAcceptance.map((spec) => auditItem(root, spec, manualEvidence));
  const summary: Record<AcceptanceStatus, number> = {
    automated: 0,
    "manual-required": 0,
    "manual-verified": 0,
    missing: 0
  };
  for (const item of items) {
    summary[item.status] += 1;
  }

  return {
    generatedAt,
    readyForRelease: summary["manual-required"] === 0 && summary.missing === 0,
    summary,
    items
  };
}

export function writeAcceptanceAudit(root: string): AcceptanceAudit {
  const audit = buildAcceptanceAudit(root);
  const outDir = join(root, "dist", "acceptance");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "acceptance-audit.json"), JSON.stringify(audit, null, 2));
  writeFileSync(join(outDir, "acceptance-audit.md"), renderMarkdown(audit));
  return audit;
}

function auditItem(root: string, spec: ItemSpec, manualEvidence: Map<string, string[]>): AcceptanceItem {
  const evidence = [
    ...spec.evidence.map((entry) => checkEvidence(root, entry)),
    ...(spec.id === "local-egress-policy" ? localEgressPolicyEvidence(root) : [])
  ];
  const hasMissing = evidence.some((line) => line.startsWith("missing:"));
  if (hasMissing) {
    return {
      id: spec.id,
      requirement: spec.requirement,
      status: "missing",
      evidence
    };
  }

  if (spec.manual) {
    const manual = manualEvidence.get(spec.id);
    const hasInvalidManualEvidence = manual?.some((line) => line.startsWith("missing:"));
    return {
      id: spec.id,
      requirement: spec.requirement,
      status: hasInvalidManualEvidence ? "missing" : manual ? "manual-verified" : "manual-required",
      evidence: manual ? [...evidence, ...manual] : evidence
    };
  }

  return {
    id: spec.id,
    requirement: spec.requirement,
    status: "automated",
    evidence
  };
}

function localEgressPolicyEvidence(root: string): string[] {
  const configPath = join(root, "ccagent.local-config.md");
  if (!existsSync(configPath)) {
    return ["local-config: ccagent.local-config.md not present"];
  }

  const env = parseLocalOperatorConfig(readFileSync(configPath, "utf8"));
  const roots = parseDelimitedLocalConfigValue(env.CCAGENT_ALLOWED_ROOTS);
  const consent = parseExternalProviderConsent(env.CCAGENT_EXTERNAL_PROVIDER_CONSENT);
  const evidence = [
    roots.length > 0
      ? `local-config: allowedRoots=${roots.join(";")}`
      : "local-config: allowedRoots=none",
    consent.length > 0
      ? `local-config: externalProviderConsent=${consent.map((entry) => `${entry.provider}:${entry.root}`).join(";")}`
      : "local-config: externalProviderConsent=none"
  ];
  return evidence;
}

function readManualEvidence(root: string): Map<string, string[]> {
  const evidencePath = join(root, "dist", "acceptance", "manual-evidence.json");
  const result = new Map<string, string[]>();
  if (!existsSync(evidencePath)) {
    return result;
  }

  let parsed: ManualEvidenceFile;
  try {
    parsed = JSON.parse(readFileSync(evidencePath, "utf8")) as ManualEvidenceFile;
  } catch (error) {
    for (const spec of finalAcceptance.filter((item) => item.manual)) {
      result.set(spec.id, [`missing: manual evidence JSON is invalid: ${String(error)}`]);
    }
    return result;
  }

  for (const spec of finalAcceptance.filter((item) => item.manual)) {
    const record = parsed.items?.[spec.id];
    if (!record) {
      continue;
    }
    const validation = validateManualEvidence(spec.id, record);
    if (validation.length === 0) {
      result.set(spec.id, [
        `manual: checkedAt=${record.checkedAt}`,
        `manual: checkedBy=${record.checkedBy}`,
        ...record.evidence!.map((line) => `manual: ${line}`)
      ]);
    } else {
      result.set(spec.id, validation.map((message) => `missing: manual evidence ${message}`));
    }
  }

  return result;
}

function validateManualEvidence(id: string, record: ManualEvidenceRecord): string[] {
  const errors: string[] = [];
  if (record.status !== "passed") {
    errors.push(`${id} status must be "passed"`);
  }
  if (!record.checkedAt || Number.isNaN(Date.parse(record.checkedAt))) {
    errors.push(`${id} checkedAt must be an ISO timestamp`);
  }
  if (!record.checkedBy?.trim()) {
    errors.push(`${id} checkedBy is required`);
  }
  if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
    errors.push(`${id} evidence must contain at least one note`);
  }
  for (const line of record.evidence ?? []) {
    if (containsSecretLikeText(line)) {
      errors.push(`${id} evidence contains secret-like text`);
      break;
    }
  }
  return errors;
}

function containsSecretLikeText(text: string): boolean {
  return /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|ccagent_[A-Za-z0-9_-]{8,}|ccagent-local-[A-Za-z0-9_-]{8,})\b/.test(
    text
  );
}

function checkEvidence(root: string, spec: EvidenceSpec): string {
  const fullPath = join(root, spec.file);
  if (!existsSync(fullPath)) {
    return `missing: ${spec.file}`;
  }

  const text = readFileSync(fullPath, "utf8");
  const missing = (spec.contains ?? []).filter((needle) => !text.includes(needle));
  if (missing.length > 0) {
    return `missing: ${spec.file} lacks ${missing.map((needle) => JSON.stringify(needle)).join(", ")}`;
  }

  return `ok: ${spec.file}`;
}

function renderMarkdown(audit: AcceptanceAudit): string {
  const lines = [
    "# CCAgent Acceptance Audit",
    "",
    `Generated: ${audit.generatedAt}`,
    `Ready for release: ${audit.readyForRelease ? "yes" : "no"}`,
    "",
    `Automated evidence: ${audit.summary.automated}`,
    `Manual required: ${audit.summary["manual-required"]}`,
    `Manual verified: ${audit.summary["manual-verified"]}`,
    `Missing evidence: ${audit.summary.missing}`,
    ""
  ];

  for (const item of audit.items) {
    lines.push(`## ${item.id}`);
    lines.push("");
    lines.push(`Status: ${item.status}`);
    lines.push(`Requirement: ${item.requirement}`);
    lines.push("");
    for (const evidence of item.evidence) {
      lines.push(`- ${evidence}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const audit = writeAcceptanceAudit(process.cwd());
  console.log(
    `Acceptance audit wrote dist/acceptance; automated=${audit.summary.automated}, manual=${audit.summary["manual-required"]}, missing=${audit.summary.missing}`
  );
  if (!audit.readyForRelease) {
    process.exitCode = 1;
  }
}
