import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DaemonSettings } from "@ccagent/core";

export const defaultDaemonSettings: DaemonSettings = {
  daemon: {
    host: "127.0.0.1",
    port: 47621,
    authTokenRef: "ccagent/daemon/token"
  },
  claude: {
    path: "claude",
    requiredVersion: ">=1.0.0"
  },
  codex: {
    path: "codex.cmd"
  },
  workspace: {
    allowedRoots: []
  },
  proxy: {
    portStart: 31000,
    portEnd: 31999
  },
  tasks: {
    defaultTimeoutMs: 600000,
    maxOutputBytes: 131072,
    maxConcurrentTasks: 4,
    overflow: "reject",
    logRetentionDays: 30
  }
};

export function createDaemonToken(): string {
  return `ccagent_${crypto.randomBytes(24).toString("hex")}`;
}

export function defaultConfigPath(): string {
  const appData = process.env.APPDATA ?? process.cwd();
  return `${appData}/CCAgent/config.json`;
}

export function loadSettingsFromFile(path = defaultConfigPath()): PartialDeep<DaemonSettings> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  return JSON.parse(stripBom(readFileSync(path, "utf8"))) as PartialDeep<DaemonSettings>;
}

export function saveSettingsToFile(settings: DaemonSettings, path = defaultConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function loadDaemonSettings(
  overrides?: PartialDeep<DaemonSettings>,
  configPath = defaultConfigPath()
): DaemonSettings {
  const fileSettings = loadSettingsFromFile(configPath);
  const settings = mergeSettings(mergeDeep(fileSettings, overrides));
  saveSettingsToFile(settings, configPath);
  return settings;
}

export function mergeSettings(settings?: PartialDeep<DaemonSettings>): DaemonSettings {
  return {
    ...defaultDaemonSettings,
    ...settings,
    daemon: { ...defaultDaemonSettings.daemon, ...settings?.daemon },
    claude: { ...defaultDaemonSettings.claude, ...settings?.claude },
    codex: { ...defaultDaemonSettings.codex, ...settings?.codex },
    workspace: { ...defaultDaemonSettings.workspace, ...settings?.workspace },
    proxy: { ...defaultDaemonSettings.proxy, ...settings?.proxy },
    tasks: { ...defaultDaemonSettings.tasks, ...settings?.tasks }
  };
}

export type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? PartialDeep<T[K]>
      : T[K];
};

function mergeDeep<T>(base?: PartialDeep<T>, override?: PartialDeep<T>): PartialDeep<T> | undefined {
  if (!base) {
    return override;
  }
  if (!override) {
    return base;
  }

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(value)) {
      result[key] = mergeDeep(baseValue, value);
    } else {
      result[key] = value;
    }
  }
  return result as PartialDeep<T>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}
