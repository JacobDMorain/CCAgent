import { ProviderConfigSchema, type ProviderConfig } from "@ccagent/core";

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

    listTasks: () => daemon.get("/tasks?limit=100"),

    cancelTask: (taskId: string) =>
      daemon.post(`/tasks/${encodeURIComponent(taskId)}/cancel`),

    readTaskOutput: (taskId: string, maxBytes = 131072) =>
      daemon.get(`/tasks/${encodeURIComponent(taskId)}/output?maxBytes=${maxBytes}`),

    setWorkspaceRoots: (allowedRoots: string[]) =>
      daemon.post("/settings/workspace-roots", { allowedRoots }) as Promise<{ allowedRoots: string[] }>
  };
}

export type GuiApiHandlers = ReturnType<typeof createGuiApiHandlers>;
