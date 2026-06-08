import { contextBridge, ipcRenderer } from "electron";
import type { ProviderConfig } from "@ccagent/core";

interface GuiApi {
  listProviders(): Promise<ProviderConfig[]>;
  saveProvider(provider: ProviderConfig, apiKey?: string): Promise<ProviderConfig>;
  testProvider(provider: string, model?: string): Promise<unknown>;
  listTasks(): Promise<unknown>;
  cancelTask(taskId: string): Promise<unknown>;
  readTaskOutput(taskId: string): Promise<unknown>;
  setWorkspaceRoots(allowedRoots: string[]): Promise<{ allowedRoots: string[] }>;
}

const api: GuiApi = {
  listProviders: () => ipcRenderer.invoke("ccagent:listProviders"),
  saveProvider: (provider: ProviderConfig, apiKey?: string) =>
    ipcRenderer.invoke("ccagent:saveProvider", provider, apiKey),
  testProvider: (provider: string, model?: string) =>
    ipcRenderer.invoke("ccagent:testProvider", provider, model),
  listTasks: () => ipcRenderer.invoke("ccagent:listTasks"),
  cancelTask: (taskId: string) => ipcRenderer.invoke("ccagent:cancelTask", taskId),
  readTaskOutput: (taskId: string) => ipcRenderer.invoke("ccagent:readTaskOutput", taskId),
  setWorkspaceRoots: (allowedRoots: string[]) =>
    ipcRenderer.invoke("ccagent:setWorkspaceRoots", allowedRoots)
};

contextBridge.exposeInMainWorld("ccagent", api);
