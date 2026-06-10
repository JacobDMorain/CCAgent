import { ProviderConfigSchema, type ProviderConfig } from "@ccagent/core";

interface GuiAutomationRunRequest {
  cwd: string;
  file: string;
  reviewers: Array<{ provider: string; model?: string }>;
  claudeTemplateId: string;
  codexTemplateId: string;
  reviewStyle?: string;
  language?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  fullyAuto?: boolean;
  maxIterations?: number;
}

interface GuiPromptTemplate {
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

export interface GuiDaemonClientLike {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  delete(path: string): Promise<unknown>;
}

export function createGuiApiHandlers(daemon: GuiDaemonClientLike) {
  return {
    listProviders: () => daemon.get("/providers") as Promise<ProviderConfig[]>,

    async saveProvider(providerInput: ProviderConfig, apiKey?: string): Promise<ProviderConfig> {
      const provider = ProviderConfigSchema.parse(providerInput);
      const saved = (await daemon.post("/providers", provider)) as ProviderConfig;
      if (apiKey) {
        await daemon.post(`/providers/${encodeURIComponent(provider.id)}/secret`, { value: apiKey });
      }
      return saved;
    },

    testProvider: (provider: string, model?: string) =>
      daemon.post("/providers/test", { provider, model }),

    deleteProvider: (providerId: string) =>
      daemon.delete(`/providers/${encodeURIComponent(providerId)}`),

    listTasks: () => daemon.get("/tasks?limit=100"),

    clearTasks: () => daemon.delete("/tasks"),

    cancelTask: (taskId: string) =>
      daemon.post(`/tasks/${encodeURIComponent(taskId)}/cancel`),

    readTaskOutput: (taskId: string, maxBytes = 131072) =>
      daemon.get(`/tasks/${encodeURIComponent(taskId)}/output?maxBytes=${maxBytes}`),

    createAutomationRun: (request: GuiAutomationRunRequest) =>
      daemon.post("/automation-runs", request),

    listAutomationRuns: () => daemon.get("/automation-runs?limit=100"),

    getAutomationRun: (runId: string) =>
      daemon.get(`/automation-runs/${encodeURIComponent(runId)}`),

    readAutomationRunOutput: (runId: string, maxBytes = 131072) =>
      daemon.get(`/automation-runs/${encodeURIComponent(runId)}/output?maxBytes=${maxBytes}`),

    deleteAutomationRun: (runId: string) =>
      daemon.delete(`/automation-runs/${encodeURIComponent(runId)}`),

    cancelAutomationRun: (runId: string) =>
      daemon.post(`/automation-runs/${encodeURIComponent(runId)}/cancel`),

    retryAutomationRun: (runId: string) =>
      daemon.post(`/automation-runs/${encodeURIComponent(runId)}/retry`),

    rerunCodexEdit: (runId: string) =>
      daemon.post(`/automation-runs/${encodeURIComponent(runId)}/rerun-codex`),

    listPromptTemplates: () => daemon.get("/prompt-templates") as Promise<GuiPromptTemplate[]>,

    savePromptTemplate: (template: GuiPromptTemplate) =>
      daemon.post("/prompt-templates", template) as Promise<GuiPromptTemplate>,

    deletePromptTemplate: (templateId: string) =>
      daemon.delete(`/prompt-templates/${encodeURIComponent(templateId)}`),

    getRuntimeSettings: () => daemon.get("/settings/runtime") as Promise<{
      claudePath: string;
      codexPath: string;
      allowedRoots: string[];
    }>,

    saveRuntimeSettings: (settings: {
      claudePath?: string;
      codexPath?: string;
      allowedRoots?: string[];
    }) => daemon.post("/settings/runtime", settings) as Promise<{
      claudePath: string;
      codexPath: string;
      allowedRoots: string[];
    }>,

    testCodex: () => daemon.post("/settings/codex/test") as Promise<{
      status: string;
      codexPath: string;
      version: string;
      latencyMs: number;
    }>,

    setWorkspaceRoots: (allowedRoots: string[]) =>
      daemon.post("/settings/workspace-roots", { allowedRoots }) as Promise<{ allowedRoots: string[] }>
  };
}

export type GuiApiHandlers = ReturnType<typeof createGuiApiHandlers>;
