import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  assertCwdAllowed,
  assertFileInsideCwd,
  AutomationRunRequestSchema,
  CCAgentError,
  createDefaultPromptTemplates,
  ErrorCodes,
  renderPromptTemplate,
  type AutomationRunRecord,
  type AutomationRunRequest,
  type PromptTemplate,
  type TaskResult
} from "@ccagent/core";
import {
  SqliteAutomationRunStore,
  SqlitePromptTemplateStore,
  SqliteTaskStore
} from "@ccagent/storage";
import type { DaemonSettings } from "@ccagent/core";
import { TaskManager } from "./taskManager.js";
import { spawnCli } from "./cliSpawn.js";

export interface CodexRunInput {
  runId: string;
  cwd: string;
  prompt: string;
  stdoutPath?: string;
  stderrPath?: string;
  timeoutMs: number;
  onStdout(text: string): void;
  onStderr(text: string): void;
  signal?: AbortSignal;
}

export interface CodexRunOutput {
  content: string;
  exitCode: number;
}

export interface AutomationOrchestration {
  runCodex(input: CodexRunInput): Promise<CodexRunOutput>;
}

export class AutomationManager {
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(
    private readonly settings: DaemonSettings,
    private readonly taskManager: TaskManager,
    private readonly taskStore: SqliteTaskStore,
    private readonly runStore: SqliteAutomationRunStore,
    private readonly templateStore: SqlitePromptTemplateStore,
    orchestration: Partial<AutomationOrchestration> = {}
  ) {
    this.orchestration = {
      runCodex: (input) => defaultRunCodex(this.settings.codex.path, input),
      ...orchestration
    };
    this.seedDefaultTemplates();
  }

  private readonly orchestration: AutomationOrchestration;

  createRun(rawRequest: unknown): AutomationRunRecord {
    const request = AutomationRunRequestSchema.parse(rawRequest);
    const cwd = assertCwdAllowed(request.cwd, this.settings.workspace.allowedRoots);
    const targetFile = assertFileInsideCwd(cwd, request.file);
    const now = new Date().toISOString();
    const runId = `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const outputDir = join(cwd, ".ccagent", "runs", runId);
    const providers = request.reviewers.map((reviewer, position) => ({
      runId,
      provider: reviewer.provider,
      model: reviewer.model,
      status: "queued" as const,
      position
    }));
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(join(outputDir, "providers"), { recursive: true });
    writeJsonFile(join(outputDir, "input.json"), {
      runId,
      targetFile,
      cwd,
      reviewers: request.reviewers,
      claudeTemplateId: request.claudeTemplateId,
      codexTemplateId: request.codexTemplateId,
      reviewStyle: request.reviewStyle,
      language: request.language,
      fullyAuto: request.fullyAuto,
      createdAt: now
    });

    const run = this.runStore.createRun({
      id: runId,
      status: "queued",
      cwd,
      file: targetFile,
      reviewStyle: request.reviewStyle,
      language: request.language,
      claudeTemplateId: request.claudeTemplateId,
      codexTemplateId: request.codexTemplateId,
      fullyAuto: request.fullyAuto,
      outputDir,
      createdAt: now,
      updatedAt: now,
      providers
    });

    const controller = new AbortController();
    this.activeRuns.set(runId, controller);
    this.executeRun(runId, request, targetFile, controller).catch((error) => {
      this.failRun(runId, error);
    });

    return run;
  }

  listRuns(limit = 100): AutomationRunRecord[] {
    return this.runStore.listRuns(limit);
  }

  deleteRun(runId: string): void {
    this.activeRuns.get(runId)?.abort();
    this.activeRuns.delete(runId);
    this.runStore.deleteRun(runId);
  }

  getRun(runId: string): AutomationRunRecord {
    const run = this.runStore.getRun(runId);
    if (!run) {
      throw new CCAgentError(ErrorCodes.TaskMissing, `automation run missing: ${runId}`);
    }
    return run;
  }

  readRunOutput(runId: string, maxBytes: number): { content: string; truncated: boolean } {
    const run = this.getRun(runId);
    const parts = [
      readOptional("review-packet.md", run.reviewPacketPath, maxBytes),
      readOptional("codex-output.md", run.codexOutputPath, maxBytes),
      readOptional("codex-decision-summary.md", join(run.outputDir, "codex-decision-summary.md"), maxBytes),
      readOptional("codex-stdout.log", run.codexPromptPath ? join(run.outputDir, "codex-stdout.log") : undefined, maxBytes),
      readOptional("codex-stderr.log", run.codexPromptPath ? join(run.outputDir, "codex-stderr.log") : undefined, maxBytes),
      readOptional("diff.patch", run.diffPath, maxBytes),
      readOptional("final-report.md", run.finalReportPath, maxBytes)
    ].filter(Boolean);
    return truncate(parts.join("\n\n"), maxBytes);
  }

  cancelRun(runId: string): AutomationRunRecord {
    this.activeRuns.get(runId)?.abort();
    const run = this.getRun(runId);
    const now = new Date().toISOString();
    for (const provider of run.providers) {
      if (provider.taskId && (provider.status === "queued" || provider.status === "running")) {
        this.taskManager.cancelTask(provider.taskId);
        this.runStore.updateProvider(runId, provider.provider, { status: "cancelled" });
      }
    }
    this.runStore.updateRun(runId, { status: "cancelled", updatedAt: now, finishedAt: now });
    return this.getRun(runId);
  }

  rerunCodex(runId: string): AutomationRunRecord {
    const run = this.getRun(runId);
    const request: AutomationRunRequest = {
      cwd: run.cwd,
      file: run.file,
      reviewers: run.providers.map((provider) => ({
        provider: provider.provider,
        model: provider.model
      })),
      claudeTemplateId: run.claudeTemplateId,
      codexTemplateId: run.codexTemplateId,
      reviewStyle: run.reviewStyle,
      language: run.language,
      fullyAuto: run.fullyAuto
    };
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);
    this.runCodexPhase(runId, request, controller).catch((error) => this.failRun(runId, error));
    return this.getRun(runId);
  }

  retryRun(runId: string): AutomationRunRecord {
    const run = this.getRun(runId);
    const reviewers = run.providers
      .filter((provider) => provider.status !== "succeeded")
      .map((provider) => ({ provider: provider.provider, model: provider.model }));
    if (reviewers.length === 0) {
      return this.rerunCodex(runId);
    }
    const request: RequiredDefaults<AutomationRunRequest> = {
      cwd: run.cwd,
      file: run.file,
      reviewers,
      claudeTemplateId: run.claudeTemplateId,
      codexTemplateId: run.codexTemplateId,
      reviewStyle: run.reviewStyle,
      language: run.language,
      timeoutMs: this.settings.tasks.defaultTimeoutMs,
      maxOutputBytes: this.settings.tasks.maxOutputBytes,
      fullyAuto: run.fullyAuto
    };
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);
    this.retryFailedProviders(runId, request, controller).catch((error) => this.failRun(runId, error));
    return this.getRun(runId);
  }

  private async executeRun(
    runId: string,
    request: RequiredDefaults<AutomationRunRequest>,
    targetFile: string,
    controller: AbortController
  ): Promise<void> {
    const now = () => new Date().toISOString();
    this.runStore.updateRun(runId, { status: "reviewing", updatedAt: now() });
    await this.runReviewers(runId, request, targetFile);

    const afterReviews = this.getRun(runId);
    const successes = afterReviews.providers.filter((provider) => provider.status === "succeeded");
    if (successes.length === 0) {
      this.runStore.updateRun(runId, {
        status: "failed",
        errorJson: JSON.stringify({ code: "CCAGENT_AUTOMATION_NO_SUCCESSFUL_REVIEWS", message: "all providers failed" }),
        updatedAt: now(),
        finishedAt: now()
      });
      this.writeFinalReport(runId, "Automation failed: all providers failed.");
      return;
    }

    this.runStore.updateRun(runId, { status: "merging", updatedAt: now() });
    const packetPath = this.writeReviewPacket(runId);
    this.runStore.updateRun(runId, {
      reviewPacketPath: packetPath,
      updatedAt: now()
    });

    await this.runCodexPhase(runId, request, controller);
  }

  private async retryFailedProviders(
    runId: string,
    request: RequiredDefaults<AutomationRunRequest>,
    controller: AbortController
  ): Promise<void> {
    const now = () => new Date().toISOString();
    this.runStore.updateRun(runId, { status: "reviewing", updatedAt: now() });
    await this.runReviewers(runId, request, this.getRun(runId).file);
    const packetPath = this.writeReviewPacket(runId);
    this.runStore.updateRun(runId, {
      status: "merging",
      reviewPacketPath: packetPath,
      updatedAt: now()
    });
    const successes = this.getRun(runId).providers.filter((provider) => provider.status === "succeeded");
    if (successes.length === 0) {
      this.runStore.updateRun(runId, {
        status: "failed",
        errorJson: JSON.stringify({ code: "CCAGENT_AUTOMATION_NO_SUCCESSFUL_REVIEWS", message: "all providers failed" }),
        updatedAt: now(),
        finishedAt: now()
      });
      this.writeFinalReport(runId, "Automation failed: all providers failed.");
      return;
    }
    await this.runCodexPhase(runId, request, controller);
  }

  private async runReviewers(
    runId: string,
    request: RequiredDefaults<AutomationRunRequest>,
    targetFile: string
  ): Promise<void> {
    const claudeTemplate = this.requiredTemplate(request.claudeTemplateId, "claude-review");
    await Promise.all(
      request.reviewers.map(async (reviewer) => {
        const run = this.getRun(runId);
        const providerDir = join(run.outputDir, "providers", reviewer.provider);
        mkdirSync(providerDir, { recursive: true });
        this.runStore.updateProvider(runId, reviewer.provider, {
          status: "running",
          errorJson: undefined
        });
        const prompt = renderPromptTemplate(claudeTemplate.content, {
          file: targetFile,
          targetDocument: targetFile,
          workspaceRoot: run.cwd,
          provider: reviewer.provider,
          reviewStyle: request.reviewStyle,
          language: request.language ?? "Chinese"
        });
        const result = await this.taskManager.runTask({
          provider: reviewer.provider,
          model: reviewer.model,
          cwd: run.cwd,
          prompt,
          files: [relative(run.cwd, targetFile)],
          mode: "sync",
          timeoutMs: request.timeoutMs,
          maxOutputBytes: request.maxOutputBytes
        });
        const outputPath = join(providerDir, "output.md");
        const errorPath = join(providerDir, "error.txt");
        if (result.status === "ok") {
          writeFileSync(outputPath, result.content ?? result.summary ?? "", "utf8");
          this.runStore.updateProvider(runId, reviewer.provider, {
            status: "succeeded",
            taskId: result.taskId,
            outputPath,
            errorJson: undefined
          });
          return;
        }
        writeFileSync(errorPath, JSON.stringify(result.error ?? { status: result.status }, null, 2), "utf8");
        this.runStore.updateProvider(runId, reviewer.provider, {
          status: providerStatusFromTask(result.status),
          taskId: result.taskId,
          errorJson: JSON.stringify(result.error ?? { status: result.status }),
          outputPath: result.content ? outputPath : undefined
        });
      })
    );
  }

  private async runCodexPhase(
    runId: string,
    request: AutomationRunRequest,
    controller: AbortController
  ): Promise<void> {
    const now = () => new Date().toISOString();
    const run = this.getRun(runId);
    if (!run.reviewPacketPath) {
      throw new CCAgentError("CCAGENT_AUTOMATION_PACKET_MISSING", `review packet missing: ${runId}`);
    }
    const codexTemplate = this.requiredTemplate(run.codexTemplateId, "codex-edit");
    const failedProviders = run.providers
      .filter((provider) => provider.status !== "succeeded")
      .map((provider) => `${provider.provider}:${provider.status}`)
      .join(", ") || "none";
    const prompt = renderPromptTemplate(codexTemplate.content, {
      runId,
      targetDocument: run.file,
      workspaceRoot: run.cwd,
      reviewPacket: run.reviewPacketPath,
      reviewResults: run.reviewPacketPath,
      failedProviders
    });
    const promptPath = join(run.outputDir, "codex-prompt.md");
    const outputPath = join(run.outputDir, "codex-output.md");
    const stdoutPath = join(run.outputDir, "codex-stdout.log");
    const stderrPath = join(run.outputDir, "codex-stderr.log");
    const targetBefore = existsSync(run.file) ? readFileSync(run.file, "utf8") : undefined;
    writeFileSync(promptPath, prompt, "utf8");
    this.runStore.updateRun(runId, {
      status: "codex_editing",
      codexPromptPath: promptPath,
      updatedAt: now()
    });
    this.runStore.upsertCodexTask({
      runId,
      taskId: `codex_${runId}`,
      status: "running",
      promptPath,
      startedAt: now()
    });

    try {
      const output = await this.orchestration.runCodex({
        runId,
          cwd: run.cwd,
          prompt,
          stdoutPath,
          stderrPath,
          timeoutMs: request.timeoutMs ?? this.settings.tasks.defaultTimeoutMs,
          onStdout: (text) => appendFileSync(stdoutPath, text, "utf8"),
          onStderr: (text) => appendFileSync(stderrPath, text, "utf8"),
          signal: controller.signal
        });
      writeFileSync(outputPath, output.content, "utf8");
      this.runStore.upsertCodexTask({
        runId,
        taskId: `codex_${runId}`,
        status: output.exitCode === 0 ? "ok" : "error",
        promptPath,
        outputPath,
        errorJson: output.exitCode === 0 ? undefined : JSON.stringify({ code: "CCAGENT_CODEX_EXIT", message: `Codex exited with code ${output.exitCode}` }),
        startedAt: this.getRun(runId).codexTask?.startedAt ?? now(),
        finishedAt: now()
      });
      if (output.exitCode !== 0) {
        throw new CCAgentError("CCAGENT_CODEX_EXIT", `Codex exited with code ${output.exitCode}`);
      }
      this.runStore.updateRun(runId, {
        status: "verifying",
        codexOutputPath: outputPath,
        updatedAt: now()
      });
      const diffPath = join(run.outputDir, "diff.patch");
      writeFileSync(diffPath, captureTargetDocumentDiff(run.cwd, run.file, targetBefore), "utf8");
      const decisionSummaryPath = join(run.outputDir, "codex-decision-summary.md");
      const decisionPromptPath = join(run.outputDir, "codex-decision-summary-prompt.md");
      const decisionPrompt = buildCodexDecisionSummaryPrompt({
        runId,
        targetDocument: run.file,
        reviewPacketPath: run.reviewPacketPath,
        codexOutputPath: outputPath,
        diffPath,
        summaryPath: decisionSummaryPath
      });
      writeFileSync(decisionPromptPath, decisionPrompt, "utf8");
      const decisionOutput = await this.orchestration.runCodex({
        runId,
        cwd: run.cwd,
        prompt: decisionPrompt,
        stdoutPath,
        stderrPath,
        timeoutMs: request.timeoutMs ?? this.settings.tasks.defaultTimeoutMs,
        onStdout: (text) => appendFileSync(stdoutPath, text, "utf8"),
        onStderr: (text) => appendFileSync(stderrPath, text, "utf8"),
        signal: controller.signal
      });
      writeFileSync(decisionSummaryPath, decisionOutput.content, "utf8");
      if (decisionOutput.exitCode !== 0) {
        throw new CCAgentError("CCAGENT_CODEX_SUMMARY_EXIT", `Codex summary exited with code ${decisionOutput.exitCode}`);
      }
      this.runStore.updateRun(runId, {
        status: "done",
        codexOutputPath: outputPath,
        diffPath,
        finalReportPath: this.writeFinalReport(runId, "Automation completed successfully."),
        updatedAt: now(),
        finishedAt: now()
      });
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  private writeReviewPacket(runId: string): string {
    const run = this.getRun(runId);
    const packetPath = join(run.outputDir, "review-packet.md");
    const sections = [
      `# CCAgent Review Packet`,
      ``,
      `Run: ${run.id}`,
      `Target: ${run.file}`,
      `Workspace: ${run.cwd}`,
      ``,
      ...run.providers.map((provider) => {
        const content = provider.outputPath && provider.status === "succeeded"
          ? readFileSync(provider.outputPath, "utf8")
          : provider.errorJson ?? "";
        return [
          `## Provider: ${provider.provider}`,
          ``,
          `Status: ${provider.status}`,
          provider.model ? `Model: ${provider.model}` : "",
          provider.taskId ? `Task: ${provider.taskId}` : "",
          ``,
          content
        ].filter(Boolean).join("\n");
      })
    ];
    writeFileSync(packetPath, sections.join("\n"), "utf8");
    return packetPath;
  }

  private writeFinalReport(runId: string, message: string): string {
    const run = this.getRun(runId);
    const path = join(run.outputDir, "final-report.md");
    writeFileSync(
      path,
      [
        "# CCAgent Automation Final Report",
        "",
        message,
        "",
        `Run: ${run.id}`,
        `Target: ${run.file}`,
        `Status: ${this.getRun(runId).status}`
      ].join("\n"),
      "utf8"
    );
    return path;
  }

  private failRun(runId: string, error: unknown): void {
    const now = new Date().toISOString();
    this.runStore.updateRun(runId, {
      status: "failed",
      errorJson: JSON.stringify({
        code: error instanceof CCAgentError ? error.code : "CCAGENT_AUTOMATION_ERROR",
        message: error instanceof Error ? error.message : String(error)
      }),
      updatedAt: now,
      finishedAt: now
    });
    this.writeFinalReport(runId, `Automation failed: ${error instanceof Error ? error.message : String(error)}`);
    this.activeRuns.delete(runId);
  }

  private seedDefaultTemplates(): void {
    for (const template of createDefaultPromptTemplates()) {
      const existing = this.templateStore.getTemplate(template.id);
      if (!existing || (existing.isDefault && existing.version < template.version)) {
        this.templateStore.saveTemplate(template);
      }
    }
  }

  private requiredTemplate(id: string, kind: PromptTemplate["kind"]): PromptTemplate {
    const template = this.templateStore.getTemplate(id);
    if (!template || template.kind !== kind) {
      throw new CCAgentError("CCAGENT_TEMPLATE_MISSING", `template missing: ${id}`);
    }
    return template;
  }
}

type RequiredDefaults<T> = T & {
  reviewStyle: NonNullable<AutomationRunRequest["reviewStyle"]>;
  timeoutMs: number;
  maxOutputBytes: number;
  fullyAuto: boolean;
};

function providerStatusFromTask(status: TaskResult["status"]) {
  if (status === "timeout") {
    return "timeout";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  return "failed";
}

function captureTargetDocumentDiff(cwd: string, targetFile: string, before: string | undefined): string {
  const after = existsSync(targetFile) ? readFileSync(targetFile, "utf8") : undefined;
  const relativeTarget = relative(cwd, targetFile) || targetFile;
  if (before === after) {
    return `Target document snapshot diff\n\nNo changes were detected in ${relativeTarget}.\n`;
  }

  return [
    "Target document snapshot diff",
    "",
    `--- a/${relativeTarget}`,
    `+++ b/${relativeTarget}`,
    "@@",
    ...simpleLineDiff(before ?? "", after ?? "")
  ].join("\n") + "\n";
}

function simpleLineDiff(before: string, after: string): string[] {
  return [
    ...before.split(/\r?\n/).filter((line, index, lines) => line !== "" || index < lines.length - 1).map((line) => `-${line}`),
    ...after.split(/\r?\n/).filter((line, index, lines) => line !== "" || index < lines.length - 1).map((line) => `+${line}`)
  ];
}

async function defaultRunCodex(codexPath: string, input: CodexRunInput): Promise<CodexRunOutput> {
  const child = spawnCli(codexPath, [
    "exec",
    "--dangerously-bypass-approvals-and-sandbox",
    "--cd",
    input.cwd,
    "-"
  ], {
    cwd: input.cwd,
    windowsHide: true
  });
  child.stdin.end(input.prompt);
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    stdout += text;
    input.onStdout(text);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    input.onStderr(text);
  });
  return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        writeDiagnostic(input.stderrPath, `\n[ccagent] Codex task timed out after ${input.timeoutMs} ms\n`);
        child.kill();
        reject(new CCAgentError(ErrorCodes.Timeout, "Codex task timed out"));
      }, input.timeoutMs);
      input.signal?.addEventListener("abort", () => {
        writeDiagnostic(input.stderrPath, "\n[ccagent] Codex task was cancelled\n");
        child.kill();
        reject(new CCAgentError(ErrorCodes.Cancelled, "Codex task was cancelled"));
      }, { once: true });
      child.once("error", (error) => {
        writeDiagnostic(input.stderrPath, `\n[ccagent] Codex process error: ${error.message}\n`);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve({ content: stdout, exitCode: code ?? 0 });
    });
  });
}

function buildCodexDecisionSummaryPrompt(input: {
  runId: string;
  targetDocument: string;
  reviewPacketPath: string;
  codexOutputPath: string;
  diffPath: string;
  summaryPath: string;
}): string {
  return [
    "You are preparing the user-facing decision summary for a CCAgent multi-provider review run.",
    "",
    `Run id: ${input.runId}`,
    `Target document: ${input.targetDocument}`,
    `Review packet: ${input.reviewPacketPath}`,
    `Codex edit output: ${input.codexOutputPath}`,
    `Target document diff: ${input.diffPath}`,
    `Write the final summary to: ${input.summaryPath}`,
    "",
    "Read the review packet, the Codex edit output, and the target document diff.",
    "Summarize what Codex accepted, rejected, or deferred from the provider reviews, using the target document diff as the source of truth for actual document changes.",
    "Do not modify the target document or any source file in this phase.",
    "Return only the decision summary in this exact structure:",
    "",
    "## Applied",
    "- Provider finding or theme:",
    "  - Decision:",
    "  - Actual document change:",
    "",
    "## Rejected",
    "- Provider finding or theme:",
    "  - Reason:",
    "",
    "## Deferred",
    "- Provider finding or theme:",
    "  - Reason:",
    "",
    "## Files Changed",
    "- Path:",
    "  - Summary:",
    "",
    "## User-Facing Summary",
    "Short paragraph focused on what changed in the reviewed document."
  ].join("\n");
}

function writeDiagnostic(path: string | undefined, text: string): void {
  if (path) {
    appendFileSync(path, text, "utf8");
  }
}

function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

function readOptional(label: string, path: string | undefined, maxBytes: number): string {
  if (!path || !existsSync(path)) {
    return "";
  }
  return `# ${label}\n\n${truncate(readFileSync(path, "utf8"), maxBytes).content}`;
}

function truncate(content: string, maxBytes: number): { content: string; truncated: boolean } {
  if (Buffer.byteLength(content, "utf8") <= maxBytes) {
    return { content, truncated: false };
  }
  return { content: content.slice(0, maxBytes), truncated: true };
}
