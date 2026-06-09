import type {
  AutomationRunRecord,
  AutomationRunRequest,
  PromptTemplate,
  ProviderConfig,
  TaskStatus
} from "@ccagent/core";

export interface GuiTaskRecord {
  id: string;
  provider: string;
  model: string;
  cwd: string;
  prompt: string;
  status: TaskStatus;
  summary?: string;
  content?: string;
  errorJson?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface GuiApi {
  listProviders(): Promise<ProviderConfig[]>;
  saveProvider(provider: ProviderConfig, apiKey?: string): Promise<ProviderConfig>;
  deleteProvider(providerId: string): Promise<unknown>;
  testProvider(provider: string, model?: string): Promise<unknown>;
  listTasks(): Promise<GuiTaskRecord[]>;
  clearTasks(): Promise<unknown>;
  cancelTask(taskId: string): Promise<unknown>;
  readTaskOutput(taskId: string): Promise<unknown>;
  createAutomationRun(request: AutomationRunRequest): Promise<AutomationRunRecord>;
  listAutomationRuns(): Promise<AutomationRunRecord[]>;
  getAutomationRun(runId: string): Promise<AutomationRunRecord>;
  readAutomationRunOutput(runId: string): Promise<unknown>;
  deleteAutomationRun(runId: string): Promise<unknown>;
  cancelAutomationRun(runId: string): Promise<unknown>;
  retryAutomationRun(runId: string): Promise<unknown>;
  rerunCodexEdit(runId: string): Promise<unknown>;
  listPromptTemplates(): Promise<PromptTemplate[]>;
  savePromptTemplate(template: PromptTemplate): Promise<PromptTemplate>;
  deletePromptTemplate(templateId: string): Promise<unknown>;
  getRuntimeSettings(): Promise<{ claudePath: string; codexPath: string; allowedRoots: string[] }>;
  saveRuntimeSettings(settings: {
    claudePath?: string;
    codexPath?: string;
    allowedRoots?: string[];
  }): Promise<{ claudePath: string; codexPath: string; allowedRoots: string[] }>;
  testCodex(): Promise<{ status: string; codexPath: string; version: string; latencyMs: number }>;
  setWorkspaceRoots(allowedRoots: string[]): Promise<{ allowedRoots: string[] }>;
}

declare global {
  interface Window {
    ccagent?: GuiApi;
  }
}
