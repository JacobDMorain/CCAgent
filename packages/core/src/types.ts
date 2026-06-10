export type ProviderMode = "anthropic-compatible" | "openai-compatible";
export type TaskStatus = "pending" | "running" | "ok" | "error" | "cancelled" | "timeout";
export type TerminalTaskStatus = "ok" | "error" | "cancelled" | "timeout";
export type ReviewStyle = "bugs" | "architecture" | "language" | "full";
export type PromptTemplateKind = "claude-review" | "codex-edit";
export type AutomationRunStatus =
  | "queued"
  | "reviewing"
  | "merging"
  | "codex_editing"
  | "verifying"
  | "done"
  | "failed"
  | "cancelled";
export type AutomationProviderStatus = "queued" | "running" | "succeeded" | "failed" | "timeout" | "cancelled";
export type AutomationIterationStatus = "running" | "completed" | "stopped" | "failed";

export interface ProviderConfig {
  id: string;
  displayName: string;
  mode: ProviderMode;
  baseUrl: string;
  apiKeyRef: string;
  auth: {
    header: "Authorization" | "x-api-key";
    scheme: "Bearer" | "Raw";
  };
  models: {
    default: string;
    review?: string;
    fast?: string;
    reasoning?: string;
  };
  capabilities: {
    streaming: boolean;
    tools: boolean;
    systemPrompt: boolean;
    thinking?: boolean;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunTaskRequest {
  provider: string;
  model?: string;
  cwd: string;
  prompt: string;
  files?: string[];
  mode?: "sync" | "async";
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ReviewFileRequest {
  provider: string;
  model?: string;
  cwd: string;
  file: string;
  reviewStyle?: ReviewStyle;
  language?: string;
  mode?: "sync" | "async";
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface ReviewBatchRequest {
  cwd: string;
  file: string;
  reviewStyle?: ReviewStyle;
  language?: string;
  reviewers: Array<{
    provider: string;
    model?: string;
  }>;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface PromptTemplate {
  id: string;
  kind: PromptTemplateKind;
  name: string;
  description: string;
  version: number;
  content: string;
  requiredVariables: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRunRequest {
  cwd: string;
  file: string;
  reviewers: Array<{
    provider: string;
    model?: string;
  }>;
  claudeTemplateId: string;
  codexTemplateId: string;
  reviewStyle?: ReviewStyle;
  language?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  fullyAuto?: boolean;
  maxIterations?: number;
}

export interface AutomationRunRecord {
  id: string;
  status: AutomationRunStatus;
  cwd: string;
  file: string;
  reviewStyle: ReviewStyle;
  language?: string;
  claudeTemplateId: string;
  codexTemplateId: string;
  fullyAuto: boolean;
  maxIterations: number;
  outputDir: string;
  reviewPacketPath?: string;
  codexPromptPath?: string;
  codexOutputPath?: string;
  diffPath?: string;
  finalReportPath?: string;
  errorJson?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  providers: AutomationRunProviderRecord[];
  codexTask?: CodexEditTaskRecord;
  iterations: AutomationRunIterationRecord[];
}

export interface AutomationRunProviderRecord {
  runId: string;
  provider: string;
  model?: string;
  taskId?: string;
  status: AutomationProviderStatus;
  errorJson?: string;
  outputPath?: string;
  position: number;
}

export interface CodexEditTaskRecord {
  runId: string;
  taskId: string;
  status: TaskStatus;
  promptPath: string;
  outputPath?: string;
  errorJson?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface AutomationRunIterationRecord {
  runId: string;
  iteration: number;
  status: AutomationIterationStatus;
  reviewPacketPath?: string;
  codexPromptPath?: string;
  codexOutputPath?: string;
  diffPath?: string;
  decisionSummaryPath?: string;
  stopDecisionPath?: string;
  stopReason?: string;
  changesDetected: boolean;
  continueRequested?: boolean;
  codexContinueRequested?: boolean;
  decisionConfidence?: "high" | "medium" | "low";
  nextFocus?: string[];
  riskFlags?: string[];
  startedAt: string;
  finishedAt?: string;
}

export interface TaskResult {
  status: TaskStatus;
  taskId: string;
  provider: string;
  model: string;
  cwd: string;
  summary?: string;
  content?: string;
  error?: {
    code: string;
    message: string;
    detail?: string;
  };
  logsRef: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface DaemonSettings {
  daemon: {
    host: "127.0.0.1";
    port: number;
    authTokenRef: string;
  };
  claude: {
    path: string;
    requiredVersion?: string;
  };
  codex: {
    path: string;
  };
  workspace: {
    allowedRoots: string[];
  };
  proxy: {
    portStart: number;
    portEnd: number;
  };
  tasks: {
    defaultTimeoutMs: number;
    maxOutputBytes: number;
    maxConcurrentTasks: number;
    overflow: "reject" | "queue";
    logRetentionDays: number;
  };
}
