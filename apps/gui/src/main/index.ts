import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "@ccagent/daemon-client";
import { createDaemon } from "@ccagent/daemon";
import { createGuiApiHandlers, type GuiApiHandlers } from "./ipcHandlers.js";

let mainWindow: BrowserWindow | undefined;
let handlers: GuiApiHandlers | undefined;

export async function startGui(): Promise<void> {
  const daemonOverride = getDaemonOverride();
  const daemon =
    daemonOverride
      ? undefined
      : await createDaemon();
  const client = new DaemonClient({
    baseUrl: daemonOverride?.baseUrl ?? daemon!.baseUrl,
    token: daemonOverride?.token ?? daemon!.authToken
  });
  handlers = createGuiApiHandlers(client);
  registerIpcHandlers(handlers);

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
  ipcMain.handle("ccagent:saveProvider", (_event, provider, apiKey) =>
    api.saveProvider(provider, apiKey)
  );
  ipcMain.handle("ccagent:testProvider", (_event, provider, model) =>
    api.testProvider(provider, model)
  );
  ipcMain.handle("ccagent:listTasks", () => api.listTasks());
  ipcMain.handle("ccagent:cancelTask", (_event, taskId) => api.cancelTask(taskId));
  ipcMain.handle("ccagent:readTaskOutput", (_event, taskId) => api.readTaskOutput(taskId));
  ipcMain.handle("ccagent:setWorkspaceRoots", (_event, allowedRoots) =>
    api.setWorkspaceRoots(allowedRoots)
  );
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startGui().catch((error) => {
    console.error(error);
    app.exit(1);
  });
}
