import http from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  assertCwdAllowed,
  assertFileInsideCwd,
  AutomationRunRequestSchema,
  buildReviewFilePrompt,
  CCAgentError,
  createBuiltInReviewRoles,
  ErrorCodes,
  PromptTemplateSchema,
  ReviewRoleSchema,
  ReviewBatchRequestSchema,
  RunTaskRequestSchema,
  type ProviderConfig,
  type ReviewRole
} from "@ccagent/core";
import {
  createBuiltInProviders,
  InMemoryProviderStore,
  parseDelimitedLocalConfigValue,
  parseExternalProviderConsent,
  parseLocalOperatorConfig,
  ProviderRegistry
} from "@ccagent/provider";
import { DpapiStore, type SecretStore } from "@ccagent/secrets";
import {
  createDatabase,
  SqliteProviderStore,
  SqliteAutomationRunStore,
  SqlitePromptTemplateStore,
  SqliteReviewRoleStore,
  SqliteReviewBatchStore,
  SqliteTaskStore,
  type ReviewBatchRecord,
  type ReviewBatchTaskRecord
} from "@ccagent/storage";
import {
  createDaemonToken,
  defaultConfigPath,
  loadDaemonSettings,
  saveSettingsToFile,
  type PartialDeep
} from "./config.js";
import { AutomationManager, type AutomationOrchestration } from "./automationManager.js";
import { TaskManager, type TaskOrchestration } from "./taskManager.js";
import type { DaemonSettings } from "@ccagent/core";
import { spawnCli } from "./cliSpawn.js";

export interface CreateDaemonOptions {
  port?: number;
  configPath?: string;
  databasePath?: string;
  settings?: PartialDeep<DaemonSettings>;
  taskStore?: SqliteTaskStore;
  secretStore?: SecretStore;
  orchestration?: Partial<TaskOrchestration>;
  automationOrchestration?: Partial<AutomationOrchestration>;
  providerTestFetch?: typeof fetch;
  localConfigPath?: string;
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
  const reviewBatchStore = new SqliteReviewBatchStore(database);
  const automationRunStore = new SqliteAutomationRunStore(database);
  const promptTemplateStore = new SqlitePromptTemplateStore(database);
  const reviewRoleStore = new SqliteReviewRoleStore(database);
  const providerStore = new SqliteProviderStore(database);
  seedBuiltInReviewRoles(reviewRoleStore);
  await syncLocalOperatorConfig({
    providerStore,
    secrets,
    settings,
    configPath,
    localConfigPath: options.localConfigPath ?? defaultLocalConfigPath()
  });
  const registry = new ProviderRegistry(new ProviderStoreAdapter(providerStore));
  const taskManager = new TaskManager(settings, registry, taskStore, secrets, options.orchestration);
  const automationManager = new AutomationManager(
    settings,
    taskManager,
    taskStore,
    automationRunStore,
    promptTemplateStore,
    reviewRoleStore,
    options.automationOrchestration
  );
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
    reviewBatchStore,
    promptTemplateStore,
    reviewRoleStore,
    automationManager,
    taskStore,
    providerTestFetch: options.providerTestFetch ?? fetch
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
        reviewBatchStore,
        promptTemplateStore,
        reviewRoleStore,
        automationManager,
        taskStore,
        providerTestFetch: options.providerTestFetch ?? fetch
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

interface LocalOperatorSyncOptions {
  providerStore: SqliteProviderStore;
  secrets: SecretStore;
  settings: DaemonSettings;
  configPath: string;
  localConfigPath: string | undefined;
}

interface LocalOperatorSyncResult {
  providers: string[];
  allowedRoots: string[];
  externalProviderConsent: Array<{ provider: string; root: string }>;
}

async function syncLocalOperatorConfig(options: LocalOperatorSyncOptions): Promise<LocalOperatorSyncResult> {
  const { providerStore, secrets, settings, configPath, localConfigPath } = options;
  const result: LocalOperatorSyncResult = {
    providers: ["glm", "deepseek"],
    allowedRoots: settings.workspace.allowedRoots,
    externalProviderConsent: []
  };
  if (!localConfigPath || !existsSync(localConfigPath)) {
    return result;
  }

  const env = parseLocalOperatorConfig(readFileSync(localConfigPath, "utf8"));
  const allowedRoots = parseDelimitedLocalConfigValue(env.CCAGENT_ALLOWED_ROOTS);
  if (allowedRoots.length > 0) {
    settings.workspace.allowedRoots = Array.from(
      new Set([...settings.workspace.allowedRoots, ...allowedRoots])
    );
    saveSettingsToFile(settings, configPath);
    result.allowedRoots = settings.workspace.allowedRoots;
  }
  result.externalProviderConsent = parseExternalProviderConsent(env.CCAGENT_EXTERNAL_PROVIDER_CONSENT);

  const providers = createBuiltInProviders();
  const now = new Date().toISOString();
  const specs = [
    {
      provider: providers.glm,
      apiKey: env.GLM_API_KEY,
      baseUrl: env.GLM_BASE_URL
    },
    {
      provider: providers.deepseek,
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL
    }
  ];

  for (const spec of specs) {
    const existing = providerStore.getProvider(spec.provider.id);
    const provider = {
      ...spec.provider,
      ...existing,
      baseUrl: spec.baseUrl ?? existing?.baseUrl ?? spec.provider.baseUrl,
      updatedAt: now
    };
    providerStore.saveProvider(provider);
    if (spec.apiKey) {
      await secrets.set(provider.apiKeyRef, spec.apiKey);
    }
  }
  return result;
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
  reviewBatchStore: SqliteReviewBatchStore;
  promptTemplateStore: SqlitePromptTemplateStore;
  reviewRoleStore: SqliteReviewRoleStore;
  automationManager: AutomationManager;
  taskManager: TaskManager;
  taskStore: SqliteTaskStore;
  providerTestFetch: typeof fetch;
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
      const body = (await readJson(request)) as { provider?: string; model?: string };
      if (!body.provider) {
        throw new CCAgentError(ErrorCodes.ProviderMissing, "provider is required");
      }
      const provider = await context.registry.getEnabledProvider(body.provider);
      const model = body.model ?? provider.models.review ?? provider.models.default;
      const startedAt = Date.now();
      await testProviderConnection({
        provider,
        model,
        apiKey: await context.secrets.get(provider.apiKeyRef),
        fetchImpl: context.providerTestFetch
      });
      writeJson(response, 200, {
        status: "ok",
        provider: provider.id,
        model,
        latencyMs: Date.now() - startedAt
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/prompt-templates") {
      writeJson(response, 200, context.promptTemplateStore.listTemplates());
      return;
    }

    if (request.method === "GET" && url.pathname === "/review-roles") {
      writeJson(response, 200, context.reviewRoleStore.listRoles());
      return;
    }

    if (request.method === "POST" && url.pathname === "/review-roles") {
      const role = ReviewRoleSchema.parse(await readJson(request));
      writeJson(response, 200, context.reviewRoleStore.saveRole(role));
      return;
    }

    if (request.method === "POST" && url.pathname === "/review-roles/generate") {
      const body = (await readJson(request)) as { cwd?: string; file?: string; language?: string };
      if (!body.cwd || !body.file) {
        throw new CCAgentError("CCAGENT_ROLE_GENERATE_INVALID", "cwd and file are required");
      }
      const cwd = assertRoleCwd(context.settings, body.cwd);
      const file = assertRoleFile(cwd, body.file);
      writeJson(response, 200, await generateReviewRoles(context.automationManager, {
        cwd,
        file,
        requestedFile: body.file,
        language: body.language,
        timeoutMs: context.settings.tasks.defaultTimeoutMs
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/review-roles/promote") {
      const body = (await readJson(request)) as { role?: unknown };
      const now = new Date().toISOString();
      const role = ReviewRoleSchema.parse({
        ...(body.role as object),
        source: "global",
        updatedAt: now,
        createdAt: (body.role as ReviewRole | undefined)?.createdAt ?? now
      });
      writeJson(response, 200, context.reviewRoleStore.saveRole(role));
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/review-roles/")) {
      context.reviewRoleStore.deleteRole(decodeURIComponent(url.pathname.split("/")[2] ?? ""));
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/prompt-templates") {
      const template = PromptTemplateSchema.parse(await readJson(request));
      writeJson(response, 200, context.promptTemplateStore.saveTemplate(template));
      return;
    }

    if (request.method === "PUT" && url.pathname.startsWith("/prompt-templates/")) {
      const templateId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
      const template = PromptTemplateSchema.parse({ ...(await readJson(request) as object), id: templateId });
      writeJson(response, 200, context.promptTemplateStore.saveTemplate(template));
      return;
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/prompt-templates/")) {
      context.promptTemplateStore.deleteTemplate(decodeURIComponent(url.pathname.split("/")[2] ?? ""));
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/providers/sync-local-config") {
      const body = (await readJson(request)) as { path?: string };
      const result = await syncLocalOperatorConfig({
        providerStore: context.providerStore,
        secrets: context.secrets,
        settings: context.settings,
        configPath: context.configPath,
        localConfigPath: body.path
      });
      writeJson(response, 200, { synced: true, ...result });
      return;
    }

    if (request.method === "POST" && url.pathname === "/tasks") {
      const parsed = RunTaskRequestSchema.parse(await readJson(request));
      const result = await context.taskManager.runTask(parsed);
      writeJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && url.pathname === "/automation-runs") {
      const parsed = AutomationRunRequestSchema.parse(await readJson(request));
      writeJson(response, 200, context.automationManager.createRun(parsed));
      return;
    }

    if (request.method === "GET" && url.pathname === "/automation-runs") {
      const limit = Number(url.searchParams.get("limit") ?? 100);
      writeJson(response, 200, context.automationManager.listRuns(limit));
      return;
    }

    if (url.pathname.startsWith("/automation-runs/")) {
      const [, , rawRunId, leaf] = url.pathname.split("/");
      const runId = decodeURIComponent(rawRunId ?? "");
      const maxBytes = Number(url.searchParams.get("maxBytes") ?? context.settings.tasks.maxOutputBytes);
      if (request.method === "GET" && leaf === "output") {
        writeJson(response, 200, context.automationManager.readRunOutput(runId, maxBytes));
        return;
      }
      if (request.method === "POST" && leaf === "cancel") {
        writeJson(response, 200, context.automationManager.cancelRun(runId));
        return;
      }
      if (request.method === "POST" && leaf === "rerun-codex") {
        writeJson(response, 200, context.automationManager.rerunCodex(runId));
        return;
      }
      if (request.method === "POST" && leaf === "retry") {
        writeJson(response, 200, context.automationManager.retryRun(runId));
        return;
      }
      if (request.method === "DELETE" && !leaf) {
        context.automationManager.deleteRun(runId);
        writeJson(response, 200, { ok: true });
        return;
      }
      if (request.method === "GET" && !leaf) {
        writeJson(response, 200, context.automationManager.getRun(runId));
        return;
      }
    }

    if (request.method === "POST" && url.pathname === "/review-batches") {
      const parsed = ReviewBatchRequestSchema.parse(await readJson(request));
      const batchId = `batch_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const startedAt = new Date().toISOString();
      const tasks: ReviewBatchTaskRecord[] = [];

      for (const [position, reviewer] of parsed.reviewers.entries()) {
        const result = await context.taskManager.runTask({
          provider: reviewer.provider,
          model: reviewer.model,
          cwd: parsed.cwd,
          prompt: buildReviewFilePrompt({
            provider: reviewer.provider,
            model: reviewer.model,
            cwd: parsed.cwd,
            file: parsed.file,
            reviewStyle: parsed.reviewStyle,
            language: parsed.language,
            timeoutMs: parsed.timeoutMs,
            maxOutputBytes: parsed.maxOutputBytes
          }),
          files: [parsed.file],
          mode: "async",
          timeoutMs: parsed.timeoutMs,
          maxOutputBytes: parsed.maxOutputBytes
        });
        tasks.push({
          provider: reviewer.provider,
          model: reviewer.model,
          taskId: result.taskId,
          position
        });
      }

      const batch = context.reviewBatchStore.createBatch({
        id: batchId,
        cwd: parsed.cwd,
        file: parsed.file,
        reviewStyle: parsed.reviewStyle,
        language: parsed.language,
        startedAt,
        tasks
      });
      writeJson(response, 200, {
        status: "running",
        batchId: batch.id,
        cwd: batch.cwd,
        file: batch.file,
        tasks: batch.tasks.map(({ position: _position, ...task }) => task),
        startedAt: batch.startedAt,
        logsRef: `ccagent://review-batches/${batch.id}`
      });
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/review-batches/")) {
      const [, , batchId, leaf] = url.pathname.split("/");
      const batch = context.reviewBatchStore.getBatch(decodeURIComponent(batchId));
      if (!batch) {
        throw new CCAgentError(ErrorCodes.TaskMissing, `review batch missing: ${batchId}`);
      }
      const maxBytes = Number(url.searchParams.get("maxBytes") ?? context.settings.tasks.maxOutputBytes);
      if (leaf === "output") {
        writeJson(response, 200, readBatchOutput(context, batch, maxBytes));
        return;
      }
      writeJson(response, 200, readBatchStatus(context, batch));
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

    if (request.method === "DELETE" && url.pathname === "/tasks") {
      context.taskStore.clearTasks();
      writeJson(response, 200, { ok: true });
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

    if (request.method === "GET" && url.pathname === "/settings/runtime") {
      writeJson(response, 200, {
        claudePath: context.settings.claude.path,
        codexPath: context.settings.codex.path,
        allowedRoots: context.settings.workspace.allowedRoots
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/settings/runtime") {
      const body = (await readJson(request)) as {
        claudePath?: string;
        codexPath?: string;
        allowedRoots?: string[];
      };
      if (body.claudePath !== undefined) {
        context.settings.claude.path = body.claudePath;
      }
      if (body.codexPath !== undefined) {
        context.settings.codex.path = body.codexPath;
      }
      if (body.allowedRoots !== undefined) {
        context.settings.workspace.allowedRoots = body.allowedRoots;
      }
      saveSettingsToFile(context.settings, context.configPath);
      writeJson(response, 200, {
        claudePath: context.settings.claude.path,
        codexPath: context.settings.codex.path,
        allowedRoots: context.settings.workspace.allowedRoots
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/settings/codex/test") {
      const startedAt = Date.now();
      const result = await testCodexCli(context.settings.codex.path);
      writeJson(response, 200, {
        status: "ok",
        codexPath: context.settings.codex.path,
        version: result.version,
        latencyMs: Date.now() - startedAt
      });
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

async function testCodexCli(codexPath: string): Promise<{ version: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawnCli(codexPath, ["--version"], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new CCAgentError(ErrorCodes.Timeout, "Codex CLI test timed out"));
    }, 10000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new CCAgentError(
        ErrorCodes.DaemonUnavailable,
        `Codex CLI test failed: ${error.message}`,
        stderr || stdout
      ));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code && code !== 0) {
        reject(new CCAgentError(
          ErrorCodes.DaemonUnavailable,
          `Codex CLI test failed with exit code ${code}`,
          stderr || stdout
        ));
        return;
      }
      resolve({ version: (stdout || stderr).trim() });
    });
  });
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

function seedBuiltInReviewRoles(store: SqliteReviewRoleStore): void {
  for (const role of createBuiltInReviewRoles()) {
    if (!store.getRole(role.id)) {
      store.saveRole(role);
    }
  }
}

function assertRoleCwd(settings: DaemonSettings, cwd: string): string {
  return assertCwdAllowed(cwd, settings.workspace.allowedRoots);
}

function assertRoleFile(cwd: string, file: string): string {
  return assertFileInsideCwd(cwd, file);
}

async function generateReviewRoles(
  automationManager: AutomationManager,
  input: { cwd: string; file: string; requestedFile?: string; language?: string; timeoutMs: number }
): Promise<{ roles: ReviewRole[] }> {
  const prompt = buildGenerateReviewRolesPrompt(input);
  const output = await automationManager.runCodexUtility({
    runId: `role_generate_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    cwd: input.cwd,
    prompt,
    timeoutMs: input.timeoutMs
  });
  if (output.exitCode !== 0) {
    throw new CCAgentError("CCAGENT_ROLE_GENERATE_FAILED", `Codex role generation exited with code ${output.exitCode}`);
  }
  const now = new Date().toISOString();
  const parsed = parseGeneratedRoles(output.content);
  return {
    roles: parsed.map((role) =>
      ReviewRoleSchema.parse({
        ...role,
        group: role.group ?? "custom",
        source: "generated",
        createdAt: role.createdAt ?? now,
        updatedAt: role.updatedAt ?? now
      })
    )
  };
}

function buildGenerateReviewRolesPrompt(input: { cwd: string; file: string; requestedFile?: string; language?: string }): string {
  return [
    "Generate review roles for a CCAgent role-based group review workflow.",
    "Think like a department manager building a superstar expert team from zero.",
    "Recruit the expert positions an HR partner would need for this document to become correct, usable, productizable, and maintainable.",
    "",
    `Workspace root: ${input.cwd}`,
    `Target document: ${input.file}`,
    input.requestedFile && input.requestedFile !== input.file ? `Requested target document: ${input.requestedFile}` : "",
    `Language: ${input.language ?? "Chinese"}`,
    "",
    "Read the target document and inspect surrounding workspace context when useful.",
    "Cover multiple functions when relevant: core technology, product delivery, user perspective, risk/opposition, business/operations, and custom domain specialists.",
    "Do not modify any file and do not start review.",
    'Use group values from: "core-technology", "documentation-quality", "product-delivery", "user-perspective", "risk-opposition", "business-operations", "custom".',
    "Return JSON only with this shape:",
    "{",
    '  "roles": [',
    "    {",
    '      "id": "stable-kebab-id",',
    '      "group": "core-technology",',
    '      "name": "角色名称",',
    '      "description": "why this expert position matters",',
    '      "focusAreas": ["area"],',
    '      "defaultSelected": true',
    "    }",
    "  ]",
    "}",
    "",
    "Do not include suggestedProviderIds."
  ].filter(Boolean).join("\n");
}

function parseGeneratedRoles(content: string): Array<Partial<ReviewRole>> {
  const direct = tryParseJson(content);
  if (direct && Array.isArray(direct.roles)) {
    return direct.roles as Array<Partial<ReviewRole>>;
  }
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParseJson(fenced[1]);
    if (parsed && Array.isArray(parsed.roles)) {
      return parsed.roles as Array<Partial<ReviewRole>>;
    }
  }
  throw new CCAgentError("CCAGENT_ROLE_GENERATE_PARSE_FAILED", "Codex did not return role JSON");
}

function tryParseJson(content: string): { roles?: unknown } | undefined {
  try {
    return JSON.parse(content) as { roles?: unknown };
  } catch {
    return undefined;
  }
}

async function testProviderConnection(input: {
  provider: ProviderConfig;
  model: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<void> {
  const response =
    input.provider.mode === "anthropic-compatible"
      ? await testAnthropicCompatibleProvider(input)
      : await testOpenAiCompatibleProvider(input);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new CCAgentError(
      ErrorCodes.ProviderUnavailable,
      `provider test failed with HTTP ${response.status}`,
      detail.slice(0, 1000)
    );
  }
}

async function testOpenAiCompatibleProvider(input: {
  provider: ProviderConfig;
  model: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<Response> {
  return input.fetchImpl(`${trimTrailingSlash(input.provider.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: buildProviderHeaders(input.provider, input.apiKey),
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false
    })
  });
}

async function testAnthropicCompatibleProvider(input: {
  provider: ProviderConfig;
  model: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<Response> {
  return input.fetchImpl(`${trimTrailingSlash(input.provider.baseUrl)}/v1/messages`, {
    method: "POST",
    headers: {
      ...buildProviderHeaders(input.provider, input.apiKey),
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false
    })
  });
}

function buildProviderHeaders(provider: ProviderConfig, apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    [provider.auth.header]: buildProviderAuthValue(provider, apiKey)
  };
}

function buildProviderAuthValue(provider: ProviderConfig, apiKey: string): string {
  if (provider.auth.header === "x-api-key") {
    return apiKey;
  }
  return provider.auth.scheme === "Bearer" ? `Bearer ${apiKey}` : apiKey;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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

function readBatchStatus(context: RouteContext, batch: ReviewBatchRecord) {
  const tasks = batch.tasks.map((task) => {
    const record = context.taskStore.getTask(task.taskId);
    return {
      provider: task.provider,
      model: task.model,
      taskId: task.taskId,
      status: record?.status ?? "error",
      error: record?.errorJson ? JSON.parse(record.errorJson) : undefined
    };
  });
  return {
    status: aggregateStatus(tasks.map((task) => task.status)),
    batchId: batch.id,
    cwd: batch.cwd,
    file: batch.file,
    tasks,
    startedAt: batch.startedAt
  };
}

function readBatchOutput(context: RouteContext, batch: ReviewBatchRecord, maxBytes: number) {
  const reviews = batch.tasks.map((task) => {
    const record = context.taskStore.getTask(task.taskId);
    const status = record?.status ?? "error";
    return {
      provider: task.provider,
      model: task.model,
      taskId: task.taskId,
      status,
      content: status === "ok" ? context.taskStore.readOutput(task.taskId, maxBytes).content : undefined,
      error: record?.errorJson ? JSON.parse(record.errorJson) : undefined
    };
  });
  return {
    status: aggregateStatus(reviews.map((review) => review.status)),
    batchId: batch.id,
    cwd: batch.cwd,
    file: batch.file,
    reviews,
    summary: summarizeReviews(reviews)
  };
}

function aggregateStatus(statuses: string[]): "running" | "ok" | "error" | "cancelled" | "timeout" {
  if (statuses.some((status) => status === "running" || status === "pending")) {
    return "running";
  }
  if (statuses.some((status) => status === "error")) {
    return "error";
  }
  if (statuses.some((status) => status === "timeout")) {
    return "timeout";
  }
  if (statuses.some((status) => status === "cancelled")) {
    return "cancelled";
  }
  return "ok";
}

function summarizeReviews(
  reviews: Array<{ provider: string; status: string; content?: string; error?: unknown }>
): string {
  return reviews
    .map((review) => {
      if (review.status === "ok") {
        return `${review.provider}: ok (${review.content?.length ?? 0} chars)`;
      }
      return `${review.provider}: ${review.status}`;
    })
    .join("\n");
}

function defaultDatabasePath(): string {
  const appData = process.env.APPDATA ?? process.cwd();
  return `${appData}/CCAgent/ccagent.sqlite`;
}

function defaultLocalConfigPath(): string {
  return process.env.CCAGENT_LOCAL_CONFIG_PATH ?? "";
}
