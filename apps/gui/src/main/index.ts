import { app, BrowserWindow, ipcMain } from "electron";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "@ccagent/daemon-client";
import { createDaemon, loadLocalDaemonConnection } from "@ccagent/daemon";
import { createGuiApiHandlers, type GuiApiHandlers } from "./ipcHandlers.js";

let mainWindow: BrowserWindow | undefined;
let handlers: GuiApiHandlers | undefined;
let daemonStartup: Promise<void> | undefined;
let daemonStartupError: Error | undefined;
let ownsDaemon = false;

export async function startGui(): Promise<void> {
  registerIpcHandlers(createPendingGuiApiHandlers());
  daemonStartup = initializeDaemon().catch((error: unknown) => {
    daemonStartupError = toError(error);
    console.error(daemonStartupError);
  });

  await app.whenReady();
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await mainWindow.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
}

async function initializeDaemon(): Promise<void> {
  daemonStartupError = undefined;
  const daemonOverride = getDaemonOverride();
  if (daemonOverride) {
    ownsDaemon = false;
    handlers = createGuiApiHandlers(new DaemonClient(daemonOverride));
    return;
  }

  const existingClient = await connectExistingDaemon();
  if (existingClient) {
    ownsDaemon = false;
    handlers = createGuiApiHandlers(existingClient);
    return;
  }

  const daemon = await createDaemonWithFallbackPort();
  const client = new DaemonClient({
    baseUrl: daemon.baseUrl,
    token: daemon.authToken
  });
  ownsDaemon = true;
  handlers = createGuiApiHandlers(client);
}

async function createDaemonWithFallbackPort() {
  try {
    return await createDaemon();
  } catch (error) {
    if (isAddressInUseError(error)) {
      return createDaemon({ port: 0 });
    }
    throw error;
  }
}

async function connectExistingDaemon(): Promise<DaemonClient | undefined> {
  const connection = await loadLocalDaemonConnection();
  if (!connection) {
    return undefined;
  }

  const client = new DaemonClient(connection);

  try {
    await client.get("/settings/runtime");
    return client;
  } catch {
    return undefined;
  }
}

function createPendingGuiApiHandlers(): GuiApiHandlers {
  const getHandlers = async (): Promise<GuiApiHandlers> => {
    await daemonStartup;
    if (handlers) {
      return handlers;
    }
    const error = daemonStartupError ?? new Error("CCAgent daemon is still starting.");
    error.name = daemonStartupError ? "DAEMON_UNAVAILABLE" : "DAEMON_STARTING";
    throw error;
  };
  const call = async <T>(operation: (api: GuiApiHandlers) => Promise<T>): Promise<T> => {
    try {
      return await operation(await getHandlers());
    } catch (error) {
      if (!shouldReinitializeDaemon(error)) {
        throw error;
      }
      handlers = undefined;
      daemonStartup = initializeDaemon().catch((startupError: unknown) => {
        daemonStartupError = toError(startupError);
        console.error(daemonStartupError);
      });
      return operation(await getHandlers());
    }
  };

  return {
    listProviders: async () => call((api) => api.listProviders()),
    listReviewRoles: async () => call((api) => api.listReviewRoles()),
    saveReviewRole: async (role) => call((api) => api.saveReviewRole(role)),
    deleteReviewRole: async (roleId) => call((api) => api.deleteReviewRole(roleId)),
    generateReviewRoles: async (request) => call((api) => api.generateReviewRoles(request)),
    promoteReviewRole: async (role) => call((api) => api.promoteReviewRole(role)),
    saveProvider: async (provider, apiKey) => call((api) => api.saveProvider(provider, apiKey)),
    deleteProvider: async (providerId) => call((api) => api.deleteProvider(providerId)),
    testProvider: async (provider, model) => call((api) => api.testProvider(provider, model)),
    listTasks: async () => call((api) => api.listTasks()),
    clearTasks: async () => call((api) => api.clearTasks()),
    cancelTask: async (taskId) => call((api) => api.cancelTask(taskId)),
    readTaskOutput: async (taskId) => call((api) => api.readTaskOutput(taskId)),
    createAutomationRun: async (request) => call((api) => api.createAutomationRun(request)),
    listAutomationRuns: async () => call((api) => api.listAutomationRuns()),
    getAutomationRun: async (runId) => call((api) => api.getAutomationRun(runId)),
    readAutomationRunOutput: async (runId) => call((api) => api.readAutomationRunOutput(runId)),
    deleteAutomationRun: async (runId) => call((api) => api.deleteAutomationRun(runId)),
    cancelAutomationRun: async (runId) => call((api) => api.cancelAutomationRun(runId)),
    retryAutomationRun: async (runId) => call((api) => api.retryAutomationRun(runId)),
    rerunCodexEdit: async (runId) => call((api) => api.rerunCodexEdit(runId)),
    listPromptTemplates: async () => call((api) => api.listPromptTemplates()),
    savePromptTemplate: async (template) => call((api) => api.savePromptTemplate(template)),
    deletePromptTemplate: async (templateId) => call((api) => api.deletePromptTemplate(templateId)),
    getRuntimeSettings: async () => call((api) => api.getRuntimeSettings()),
    saveRuntimeSettings: async (settings) => call((api) => api.saveRuntimeSettings(settings)),
    testCodex: async () => call((api) => api.testCodex()),
    setWorkspaceRoots: async (allowedRoots) => call((api) => api.setWorkspaceRoots(allowedRoots))
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isAddressInUseError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
}

function shouldReinitializeDaemon(error: unknown): boolean {
  return ownsDaemon && error instanceof Error && "code" in error && error.code === "CCAGENT_DAEMON_UNAVAILABLE";
}

function getDaemonOverride(): { baseUrl: string; token: string } | undefined {
  const baseUrl = getArgValue("--ccagent-daemon-url") ?? process.env.CCAGENT_DAEMON_URL;
  const token = getArgValue("--ccagent-daemon-token") ?? process.env.CCAGENT_DAEMON_TOKEN;
  return baseUrl && token ? { baseUrl, token } : undefined;
}

function getArgValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const fromArgv = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (fromArgv) {
    return fromArgv;
  }
  return app.commandLine.getSwitchValue(name.replace(/^--/, "")) || undefined;
}

export function registerIpcHandlers(api: GuiApiHandlers): void {
  ipcMain.handle("ccagent:listProviders", () => api.listProviders());
  ipcMain.handle("ccagent:listReviewRoles", () => api.listReviewRoles());
  ipcMain.handle("ccagent:saveReviewRole", (_event, role) => api.saveReviewRole(role));
  ipcMain.handle("ccagent:deleteReviewRole", (_event, roleId) => api.deleteReviewRole(roleId));
  ipcMain.handle("ccagent:generateReviewRoles", (_event, request) =>
    api.generateReviewRoles(request)
  );
  ipcMain.handle("ccagent:promoteReviewRole", (_event, role) => api.promoteReviewRole(role));
  ipcMain.handle("ccagent:saveProvider", (_event, provider, apiKey) =>
    api.saveProvider(provider, apiKey)
  );
  ipcMain.handle("ccagent:deleteProvider", (_event, providerId) =>
    api.deleteProvider(providerId)
  );
  ipcMain.handle("ccagent:testProvider", (_event, provider, model) =>
    api.testProvider(provider, model)
  );
  ipcMain.handle("ccagent:listTasks", () => api.listTasks());
  ipcMain.handle("ccagent:clearTasks", () => api.clearTasks());
  ipcMain.handle("ccagent:cancelTask", (_event, taskId) => api.cancelTask(taskId));
  ipcMain.handle("ccagent:readTaskOutput", (_event, taskId) => api.readTaskOutput(taskId));
  ipcMain.handle("ccagent:createAutomationRun", (_event, request) =>
    api.createAutomationRun(request)
  );
  ipcMain.handle("ccagent:listAutomationRuns", () => api.listAutomationRuns());
  ipcMain.handle("ccagent:getAutomationRun", (_event, runId) => api.getAutomationRun(runId));
  ipcMain.handle("ccagent:readAutomationRunOutput", (_event, runId) =>
    api.readAutomationRunOutput(runId)
  );
  ipcMain.handle("ccagent:deleteAutomationRun", (_event, runId) =>
    api.deleteAutomationRun(runId)
  );
  ipcMain.handle("ccagent:cancelAutomationRun", (_event, runId) =>
    api.cancelAutomationRun(runId)
  );
  ipcMain.handle("ccagent:retryAutomationRun", (_event, runId) =>
    api.retryAutomationRun(runId)
  );
  ipcMain.handle("ccagent:rerunCodexEdit", (_event, runId) => api.rerunCodexEdit(runId));
  ipcMain.handle("ccagent:listPromptTemplates", () => api.listPromptTemplates());
  ipcMain.handle("ccagent:savePromptTemplate", (_event, template) =>
    api.savePromptTemplate(template)
  );
  ipcMain.handle("ccagent:deletePromptTemplate", (_event, templateId) =>
    api.deletePromptTemplate(templateId)
  );
  ipcMain.handle("ccagent:getRuntimeSettings", () => api.getRuntimeSettings());
  ipcMain.handle("ccagent:saveRuntimeSettings", (_event, settings) =>
    api.saveRuntimeSettings(settings)
  );
  ipcMain.handle("ccagent:testCodex", () => api.testCodex());
  ipcMain.handle("ccagent:setWorkspaceRoots", (_event, allowedRoots) =>
    api.setWorkspaceRoots(allowedRoots)
  );
}

if (isMainEntry()) {
  startGui().catch((error) => {
    console.error(error);
    app.exit(1);
  });
}

function isMainEntry(): boolean {
  return process.argv[1]
    ? import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href
    : false;
}
