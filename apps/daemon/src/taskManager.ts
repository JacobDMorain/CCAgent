import {
  assertCwdAllowed,
  assertFileInsideCwd,
  CCAgentError,
  ErrorCodes,
  type ProviderConfig,
  type RunTaskRequest,
  type TaskResult
} from "@ccagent/core";
import { ProviderRegistry, resolveProviderModel } from "@ccagent/provider";
import type { ClaudeRunInput, ParsedClaudeOutput } from "@ccagent/runner";
import { checkClaudeBinary, runClaude as defaultRunClaude } from "@ccagent/runner";
import type { PortAllocation, ProxyTaskConfig, StartedProxy } from "@ccagent/proxy";
import { PortAllocator, startProxy as defaultStartProxy } from "@ccagent/proxy";
import type { SecretStore } from "@ccagent/secrets";
import { SqliteTaskStore } from "@ccagent/storage";
import type { DaemonSettings } from "@ccagent/core";

export interface TaskOrchestration {
  runClaude(input: ClaudeRunInput): Promise<ParsedClaudeOutput>;
  checkClaudeBinary(claudePath: string): Promise<string>;
  startProxy(config: ProxyTaskConfig): Promise<StartedProxy>;
  allocatePort(): Promise<PortAllocation>;
}

export class TaskManager {
  private running = 0;
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(
    private readonly settings: DaemonSettings,
    private readonly providers: ProviderRegistry,
    private readonly tasks: SqliteTaskStore,
    private readonly secrets: SecretStore,
    orchestration: Partial<TaskOrchestration> = {}
  ) {
    this.orchestration = {
      ...createDefaultOrchestration(settings),
      ...orchestration
    };
  }

  private readonly orchestration: TaskOrchestration;

  async runTask(request: RunTaskRequest): Promise<TaskResult> {
    const cwd = assertCwdAllowed(request.cwd, this.settings.workspace.allowedRoots);
    for (const file of request.files ?? []) {
      assertFileInsideCwd(cwd, file);
    }

    if (this.running >= this.settings.tasks.maxConcurrentTasks) {
      throw new CCAgentError(ErrorCodes.TaskLimit, "max concurrent task limit reached");
    }

    const provider = await this.providers.getEnabledProvider(request.provider);
    const model = resolveProviderModel(provider, request.model);
    const taskId = `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const startedAt = new Date().toISOString();
    this.tasks.createTask({
      id: taskId,
      provider: provider.id,
      model,
      cwd: request.cwd,
      prompt: request.prompt,
      startedAt
    });
    this.tasks.updateTask(taskId, { status: "running" });
    this.tasks.appendLog(taskId, "system", "Task runner started");

    const execution = this.executeTask({
      cwd,
      model,
      provider,
      request,
      startedAt,
      taskId
    });

    if (request.mode === "async") {
      execution.catch(() => undefined);
      return {
        status: "running",
        taskId,
        provider: provider.id,
        model,
        cwd,
        logsRef: logsRef(taskId),
        startedAt
      } as TaskResult;
    }

    return execution;
  }

  cancelTask(taskId: string) {
    const controller = this.activeControllers.get(taskId);
    if (controller) {
      controller.abort();
    }
    return this.tasks.cancelTask(taskId);
  }

  private async buildOpenAiCompatibleEnv(
    taskId: string,
    provider: ProviderConfig,
    model: string,
    apiKey: string,
    onStarted: (proxy: StartedProxy, allocation: PortAllocation, localToken: string) => void
  ): Promise<Record<string, string>> {
    const portAllocation = await this.orchestration.allocatePort();
    try {
      const localToken = `ccagent-local-${taskId}`;
      const proxy = await this.orchestration.startProxy({
        taskId,
        localToken,
        listenHost: "127.0.0.1",
        port: portAllocation.port,
        upstreamBaseUrl: provider.baseUrl,
        upstreamApiKey: apiKey,
        upstreamAuth: provider.auth,
        model,
        streaming: provider.capabilities.streaming
      });
      onStarted(proxy, portAllocation, localToken);
      return buildAnthropicEnv(proxy.baseUrl, localToken, model);
    } catch (error) {
      await portAllocation.release();
      throw error;
    }
  }

  private async executeTask(input: ExecuteTaskInput): Promise<TaskResult> {
    this.running += 1;
    const { cwd, model, provider, request, startedAt, taskId } = input;
    let proxy: StartedProxy | undefined;
    let portAllocation: PortAllocation | undefined;
    const abortController = new AbortController();
    this.activeControllers.set(taskId, abortController);
    try {
      const apiKey = await this.secrets.get(provider.apiKeyRef);
      const redactor = createTaskRedactor([apiKey]);
      const env =
        provider.mode === "openai-compatible"
          ? await this.buildOpenAiCompatibleEnv(
              taskId,
              provider,
              model,
              apiKey,
              (startedProxy, allocation, localToken) => {
                proxy = startedProxy;
                portAllocation = allocation;
                redactor.add(localToken);
              }
            )
          : buildAnthropicEnv(provider.baseUrl, apiKey, model);

      await this.orchestration.checkClaudeBinary(this.settings.claude.path);
      const output = await this.orchestration.runClaude({
        taskId,
        cwd,
        prompt: request.prompt,
        claudePath: this.settings.claude.path,
        env,
        timeoutMs: request.timeoutMs ?? this.settings.tasks.defaultTimeoutMs,
        outputFormat: "json",
        onStdout: (text) => this.tasks.appendLog(taskId, "stdout", redactor.redact(text)),
        onStderr: (text) => this.tasks.appendLog(taskId, "stderr", redactor.redact(text)),
        signal: abortController.signal
      });
      const content = redactor.redact(output.content);
      const summary = redactor.redact(output.summary ?? output.content);
      const finishedAt = new Date().toISOString();
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
      this.tasks.updateTask(taskId, {
        status: "ok",
        content,
        summary,
        finishedAt,
        durationMs
      });

      return {
        status: "ok",
        taskId,
        provider: provider.id,
        model,
        cwd,
        summary,
        content,
        logsRef: logsRef(taskId),
        startedAt,
        finishedAt,
        durationMs
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
      const status = terminalStatusForError(error);
      const taskError = createTaskRedactor().redactError(serializeTaskError(error));
      this.tasks.appendLog(taskId, "system", `${taskError.code}: ${taskError.message}`);
      this.tasks.updateTask(taskId, {
        status,
        errorJson: JSON.stringify(taskError),
        finishedAt,
        durationMs
      });

      return {
        status,
        taskId,
        provider: provider.id,
        model,
        cwd,
        error: taskError,
        logsRef: logsRef(taskId),
        startedAt,
        finishedAt,
        durationMs
      };
    } finally {
      this.activeControllers.delete(taskId);
      if (proxy) {
        await proxy.stop();
      }
      if (portAllocation) {
        await portAllocation.release();
      }
      this.running -= 1;
    }
  }
}

interface ExecuteTaskInput {
  cwd: string;
  model: string;
  provider: ProviderConfig;
  request: RunTaskRequest;
  startedAt: string;
  taskId: string;
}

function createDefaultOrchestration(settings: DaemonSettings): TaskOrchestration {
  const ports = new PortAllocator(settings.proxy);
  return {
    runClaude: defaultRunClaude,
    checkClaudeBinary,
    startProxy: defaultStartProxy,
    allocatePort: () => ports.allocate()
  };
}

function buildAnthropicEnv(baseUrl: string, token: string, model: string): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model
  };
}

function serializeTaskError(error: unknown): NonNullable<TaskResult["error"]> {
  if (error instanceof CCAgentError) {
    return {
      code: error.code,
      message: error.message,
      detail: error.detail
    };
  }

  return {
    code: "CCAGENT_DAEMON_ERROR",
    message: error instanceof Error ? error.message : String(error)
  };
}

function terminalStatusForError(error: unknown): TaskResult["status"] {
  if (error instanceof CCAgentError) {
    if (error.code === ErrorCodes.Timeout) {
      return "timeout";
    }
    if (error.code === ErrorCodes.Cancelled) {
      return "cancelled";
    }
  }

  return "error";
}

function logsRef(taskId: string): string {
  return `ccagent://tasks/${taskId}/logs`;
}

function createTaskRedactor(initialSecrets: string[] = []) {
  const secrets = new Set(initialSecrets.filter(Boolean));
  return {
    add(secret: string): void {
      if (secret) {
        secrets.add(secret);
      }
    },
    redact(text: string): string {
      let redacted = text;
      for (const secret of secrets) {
        redacted = redacted.split(secret).join("[REDACTED]");
      }
      return redacted.replace(secretLikePattern, "[REDACTED]");
    },
    redactError(error: NonNullable<TaskResult["error"]>): NonNullable<TaskResult["error"]> {
      return {
        code: error.code,
        message: this.redact(error.message),
        detail: error.detail === undefined ? undefined : this.redact(error.detail)
      };
    }
  };
}

const secretLikePattern =
  /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|ccagent_[A-Za-z0-9_-]{8,}|ccagent-local-[A-Za-z0-9_-]{8,})\b/g;
