import { DpapiStore } from "@ccagent/secrets";
import { loadDaemonSettings } from "./config.js";

export interface LocalDaemonConnection {
  baseUrl: string;
  token: string;
}

export async function loadLocalDaemonConnection(): Promise<LocalDaemonConnection | undefined> {
  const settings = loadDaemonSettings();
  const secrets = new DpapiStore();
  if (!(await secrets.has(settings.daemon.authTokenRef))) {
    return undefined;
  }

  return {
    baseUrl: `http://${settings.daemon.host}:${settings.daemon.port}`,
    token: await secrets.get(settings.daemon.authTokenRef)
  };
}
