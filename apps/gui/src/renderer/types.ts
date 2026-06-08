import type { ProviderConfig, TaskStatus } from "@ccagent/core";

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
  testProvider(provider: string, model?: string): Promise<unknown>;
  listTasks(): Promise<GuiTaskRecord[]>;
  cancelTask(taskId: string): Promise<unknown>;
  readTaskOutput(taskId: string): Promise<unknown>;
  setWorkspaceRoots(allowedRoots: string[]): Promise<{ allowedRoots: string[] }>;
}

declare global {
  interface Window {
    ccagent?: GuiApi;
  }
}
