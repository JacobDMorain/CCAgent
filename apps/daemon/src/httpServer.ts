import http from "node:http";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CCAgentError, ErrorCodes, RunTaskRequestSchema, type ProviderConfig } from "@ccagent/core";
import { InMemoryProviderStore, ProviderRegistry } from "@ccagent/provider";
import { DpapiStore, type SecretStore } from "@ccagent/secrets";
import { createDatabase, SqliteProviderStore, SqliteTaskStore } from "@ccagent/storage";
import {
  createDaemonToken,
  defaultConfigPath,
  loadDaemonSettings,
  saveSettingsToFile,
  type PartialDeep
} from "./config.js";
import { TaskManager, type TaskOrchestration } from "./taskManager.js";
import type { DaemonSettings } from "@ccagent/core";

export interface CreateDaemonOptions {
  port?: number;
  configPath?: string;
  databasePath?: string;
  settings?: PartialDeep<DaemonSettings>;
  taskStore?: SqliteTaskStore;
  secretStore?: SecretStore;
  orchestration?: Partial<TaskOrchestration>;
}

export interface StartedDaemon {
  baseUrl: string;
  authToken: string;
  stop(): Promise<void>;
}

export async function createDaemon(options: CreateDaemonOptions = {}): Promise<StartedDaemon> {
  const configPath = options.configPath ?? defaultConfigPath();
  const settings = loadDaemonSettings(options.settings, configPath);
  settings.daemon.port = options.port ?? settings.daemon.port;
  const secrets = options.secretStore ?? new DpapiStore();
  let authToken = await getOrCreateDaemonToken(secrets, settings.daemon.authTokenRef);

  const databasePath = options.databasePath ?? defaultDatabasePath();
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }
  const database = createDatabase(databasePath);
  const taskStore = options.taskStore ?? new SqliteTaskStore(database);
  const providerStore = new SqliteProviderStore(database);
  const registry = new ProviderRegistry(new ProviderStoreAdapter(providerStore));
  const taskManager = new TaskManager(settings, registry, taskStore, secrets, options.orchestration);
  recoverOrphanedTasks(taskStore);

  const auth = {
    token: authToken
  };

  let server = createHttpServer({
    auth,
    providerStore,
    registry,
    secrets,
    configPath,
    settings,
    taskManager,
    taskStore
  });

  let address = await listen(server, settings);
  if (settings.daemon.port === 0) {
    let attempts = 0;
    while (isFetchBlockedPort(address.port) && attempts < 20) {
      attempts += 1;
      await closeServer(server);
      server = createHttpServer({
        auth,
        providerStore,
        registry,
        secrets,
        configPath,
        settings,
        taskManager,
        taskStore
      });
      address = await listen(server, settings);
    }
  }

  if (isFetchBlockedPort(address.port)) {
    await closeServer(server);
    throw new Error(`daemon selected fetch-blocked port: ${address.port}`);
  }

  let stopped = false;
  return {
    authToken,
    baseUrl: `http://${settings.daemon.host}:${address.port}`,
    async stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      await closeServer(server);
      database.close();
    }
  };
}

function createHttpServer(context: Omit<RouteContext, "request" | "response">): http.Server {
  return http.createServer((request, response) => {
    void route({
      ...context,
      request,
      response
    });
  });
}

async function listen(server: http.Server, settings: DaemonSettings): Promise<Exclude<ReturnType<http.Server["address"]>, string | null>> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(settings.daemon.port, settings.daemon.host, resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("expected TCP address");
  }

  return address;
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

interface RouteContext {
  auth: {
    token: string;
  };
  providerStore: SqliteProviderStore;
  registry: ProviderRegistry;
  configPath: string;
  request: http.IncomingMessage;
  response: http.ServerResponse;
  secrets: SecretStore;
  settings: DaemonSettings;
  taskManager: TaskManager;
  taskStore: SqliteTaskStore;
}

async function route(context: RouteContext): Promise<void> {
  const { request, response } = context;
  try {
    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, { status: "ok" });
      return;
    }

    if (!isAuthorized(context.auth.token, request)) {
      writeJson(response, 401, { error: { code: "CCAGENT_UNAUTHORIZED", message: "unauthorized" } });
      return;
    }

    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/providers") {
      writeJson(response, 200, context.providerStore.listProviders());
      return;
    }

    if (request.method === "POST" && url.pathname === "/providers") {
      const provider = (await readJson(request)) as ProviderConfig;
      context.providerStore.saveProvider(provider);
      writeJson(response, 200, provider);
      return;
    }

    if (request.method === "POST" && url.pathname.match(/^\/providers\/[^/]+\/secret$/)) {
      const providerId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const provider = context.providerStore.getProvider(providerId);
      if (!provider) {
        throw new CCAgentError(ErrorCodes.ProviderMissing, `provider not found: ${providerId}`);
      }
      const body = (await readJson(request)) as { value?: string };
      await context.secrets.set(provider.apiKeyRef, body.value ?? "");
      writeJson(response, 200, { fingerprint: await context.secrets.fingerprint(provider.apiKeyRef) });
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/providers/")) {
      context.providerStore.deleteProvider(decodeURIComponent(url.pathname.split("/")[2] ?? ""));
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/providers/test") {
      const body = (await readJson(request)) as { provider?: string };
      if (!body.provider) {
        throw new CCAgentError(ErrorCodes.ProviderMissing, "provider is required");
      }
      const provider = await context.registry.getEnabledProvider(body.provider);
      writeJson(response, 200, { status: "ok", provider: provider.id, latencyMs: 0 });
      return;
    }

    if (request.method === "POST" && url.pathname === "/tasks") {
      const parsed = RunTaskRequestSchema.parse(await readJson(request));
      const result = await context.taskManager.runTask(parsed);
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname.match(/^\/tasks\/[^/]+\/cancel$/)) {
      const taskId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const task = context.taskManager.cancelTask(taskId);
      writeJson(response, 200, { taskId, status: task.status });
      return;
    }

    if (request.method === "GET" && url.pathname === "/tasks") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      writeJson(response, 200, context.taskStore.listTasks(limit));
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/tasks/")) {
      const [, , taskId, leaf] = url.pathname.split("/");
      const maxBytes = Number(url.searchParams.get("maxBytes") ?? context.settings.tasks.maxOutputBytes);
      if (leaf === "output") {
        writeJson(response, 200, context.taskStore.readOutput(taskId, maxBytes));
        return;
      }
      if (leaf === "logs") {
        writeJson(response, 200, context.taskStore.readLogs(taskId, maxBytes));
        return;
      }
      const task = context.taskStore.getTask(taskId);
      if (!task) {
        throw new CCAgentError(ErrorCodes.TaskMissing, `task missing: ${taskId}`);
      }
      writeJson(response, 200, task);
      return;
    }

    if (request.method === "POST" && url.pathname === "/auth/rotate-token") {
      const token = createDaemonToken();
      await context.secrets.set(context.settings.daemon.authTokenRef, token);
      context.auth.token = token;
      writeJson(response, 200, { token });
      return;
    }

    if (request.method === "POST" && url.pathname === "/settings/workspace-roots") {
      const body = (await readJson(request)) as { allowedRoots?: string[] };
      context.settings.workspace.allowedRoots = body.allowedRoots ?? [];
      saveSettingsToFile(context.settings, context.configPath);
      writeJson(response, 200, { allowedRoots: context.settings.workspace.allowedRoots });
      return;
    }

    writeJson(response, 404, { error: { code: "CCAGENT_NOT_FOUND", message: "not found" } });
  } catch (error) {
    const status = error instanceof CCAgentError ? 400 : 500;
    writeJson(response, status, {
      error: {
        code: error instanceof CCAgentError ? error.code : "CCAGENT_DAEMON_ERROR",
        message: error instanceof Error ? error.message : String(error),
        detail: error instanceof CCAgentError ? error.detail : undefined
      }
    });
  }
}

async function getOrCreateDaemonToken(secrets: SecretStore, ref: string): Promise<string> {
  try {
    if (await secrets.has(ref)) {
      return await secrets.get(ref);
    }

    const token = createDaemonToken();
    await secrets.set(ref, token);
    return token;
  } catch (error) {
    throw new CCAgentError(
      ErrorCodes.DaemonAuthUnavailable,
      "daemon auth token is unavailable",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function recoverOrphanedTasks(taskStore: SqliteTaskStore): void {
  for (const task of taskStore.listTasks(Number.MAX_SAFE_INTEGER)) {
    if (task.status === "pending" || task.status === "running") {
      taskStore.updateTask(task.id, {
        status: "error",
        errorJson: JSON.stringify({
          code: ErrorCodes.DaemonRecovered,
          message: "Task was recovered after daemon startup"
        }),
        finishedAt: new Date().toISOString()
      });
      taskStore.appendLog(task.id, "system", "Task marked as recovered daemon error");
    }
  }
}

class ProviderStoreAdapter {
  constructor(private readonly store: SqliteProviderStore) {}

  async delete(id: string): Promise<void> {
    this.store.deleteProvider(id);
  }

  async get(id: string): Promise<ProviderConfig | undefined> {
    return this.store.getProvider(id);
  }

  async list(): Promise<ProviderConfig[]> {
    return this.store.listProviders();
  }

  async save(provider: ProviderConfig): Promise<void> {
    this.store.saveProvider(provider);
  }
}

function isAuthorized(token: string, request: http.IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk.toString();
  }
  return raw ? JSON.parse(raw) : {};
}

function writeJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function isFetchBlockedPort(port: number): boolean {
  return FETCH_BLOCKED_PORTS.has(port);
}

const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161,
  179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563,
  587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061,
  6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080
]);

function defaultDatabasePath(): string {
  const appData = process.env.APPDATA ?? process.cwd();
  return `${appData}/CCAgent/ccagent.sqlite`;
}
