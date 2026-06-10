import { contextBridge, ipcRenderer } from "electron";
import type { ProviderConfig, ReviewRole } from "@ccagent/core";

interface AutomationRunRequest {
  cwd: string;
  file: string;
  reviewers: Array<{ provider: string; model?: string; roleIds?: string[] }>;
  roles?: ReviewRole[];
  claudeTemplateId: string;
  codexTemplateId: string;
  reviewStyle?: string;
  language?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  fullyAuto?: boolean;
  maxIterations?: number;
}

interface PromptTemplate {
  id: string;
  kind: "claude-review" | "codex-edit";
  name: string;
  description: string;
  version: number;
  content: string;
  requiredVariables: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface GuiApi {
  listProviders(): Promise<ProviderConfig[]>;
  listReviewRoles(): Promise<ReviewRole[]>;
  saveReviewRole(role: ReviewRole): Promise<ReviewRole>;
  deleteReviewRole(roleId: string): Promise<unknown>;
  generateReviewRoles(request: { cwd: string; file: string; language?: string }): Promise<{ roles: ReviewRole[] }>;
  promoteReviewRole(role: ReviewRole): Promise<ReviewRole>;
  saveProvider(provider: ProviderConfig, apiKey?: string): Promise<ProviderConfig>;
  deleteProvider(providerId: string): Promise<unknown>;
  testProvider(provider: string, model?: string): Promise<unknown>;
  listTasks(): Promise<unknown>;
  clearTasks(): Promise<unknown>;
  cancelTask(taskId: string): Promise<unknown>;
  readTaskOutput(taskId: string): Promise<unknown>;
  createAutomationRun(request: AutomationRunRequest): Promise<unknown>;
  listAutomationRuns(): Promise<unknown>;
  getAutomationRun(runId: string): Promise<unknown>;
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
  testCodex(): Promise<unknown>;
  setWorkspaceRoots(allowedRoots: string[]): Promise<{ allowedRoots: string[] }>;
}

const api: GuiApi = {
  listProviders: () => ipcRenderer.invoke("ccagent:listProviders"),
  listReviewRoles: () => ipcRenderer.invoke("ccagent:listReviewRoles"),
  saveReviewRole: (role: ReviewRole) => ipcRenderer.invoke("ccagent:saveReviewRole", role),
  deleteReviewRole: (roleId: string) => ipcRenderer.invoke("ccagent:deleteReviewRole", roleId),
  generateReviewRoles: (request) => ipcRenderer.invoke("ccagent:generateReviewRoles", request),
  promoteReviewRole: (role: ReviewRole) => ipcRenderer.invoke("ccagent:promoteReviewRole", role),
  saveProvider: (provider: ProviderConfig, apiKey?: string) =>
    ipcRenderer.invoke("ccagent:saveProvider", provider, apiKey),
  deleteProvider: (providerId: string) => ipcRenderer.invoke("ccagent:deleteProvider", providerId),
  testProvider: (provider: string, model?: string) =>
    ipcRenderer.invoke("ccagent:testProvider", provider, model),
  listTasks: () => ipcRenderer.invoke("ccagent:listTasks"),
  clearTasks: () => ipcRenderer.invoke("ccagent:clearTasks"),
  cancelTask: (taskId: string) => ipcRenderer.invoke("ccagent:cancelTask", taskId),
  readTaskOutput: (taskId: string) => ipcRenderer.invoke("ccagent:readTaskOutput", taskId),
  createAutomationRun: (request: AutomationRunRequest) =>
    ipcRenderer.invoke("ccagent:createAutomationRun", request),
  listAutomationRuns: () => ipcRenderer.invoke("ccagent:listAutomationRuns"),
  getAutomationRun: (runId: string) => ipcRenderer.invoke("ccagent:getAutomationRun", runId),
  readAutomationRunOutput: (runId: string) =>
    ipcRenderer.invoke("ccagent:readAutomationRunOutput", runId),
  deleteAutomationRun: (runId: string) => ipcRenderer.invoke("ccagent:deleteAutomationRun", runId),
  cancelAutomationRun: (runId: string) => ipcRenderer.invoke("ccagent:cancelAutomationRun", runId),
  retryAutomationRun: (runId: string) => ipcRenderer.invoke("ccagent:retryAutomationRun", runId),
  rerunCodexEdit: (runId: string) => ipcRenderer.invoke("ccagent:rerunCodexEdit", runId),
  listPromptTemplates: () => ipcRenderer.invoke("ccagent:listPromptTemplates"),
  savePromptTemplate: (template: PromptTemplate) =>
    ipcRenderer.invoke("ccagent:savePromptTemplate", template),
  deletePromptTemplate: (templateId: string) =>
    ipcRenderer.invoke("ccagent:deletePromptTemplate", templateId),
  getRuntimeSettings: () => ipcRenderer.invoke("ccagent:getRuntimeSettings"),
  saveRuntimeSettings: (settings) => ipcRenderer.invoke("ccagent:saveRuntimeSettings", settings),
  testCodex: () => ipcRenderer.invoke("ccagent:testCodex"),
  setWorkspaceRoots: (allowedRoots: string[]) =>
    ipcRenderer.invoke("ccagent:setWorkspaceRoots", allowedRoots)
};

contextBridge.exposeInMainWorld("ccagent", api);
