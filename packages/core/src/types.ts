export type ProviderMode = "anthropic-compatible" | "openai-compatible";
export type TaskStatus = "pending" | "running" | "ok" | "error" | "cancelled" | "timeout";
export type TerminalTaskStatus = "ok" | "error" | "cancelled" | "timeout";
export type ReviewStyle = "bugs" | "architecture" | "language" | "full";

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
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface TaskResult {
  status: TerminalTaskStatus;
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
