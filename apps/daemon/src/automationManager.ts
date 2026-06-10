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
      maxIterations: request.maxIterations,
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
      maxIterations: request.maxIterations,
      outputDir,
      createdAt: now,
      updatedAt: now,
      providers,
      iterations: []
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
    const latestIteration = [...run.iterations].reverse().find((iteration) => iteration.decisionSummaryPath);
    const parts = [
      readOptional("final-report.md", run.finalReportPath, maxBytes),
      readOptional("codex-decision-summary.md", latestIteration?.decisionSummaryPath, maxBytes),
      ...run.iterations.flatMap((iteration) => [
        readOptional(`iteration-${String(iteration.iteration).padStart(3, "0")}/codex-decision-summary.md`, iteration.decisionSummaryPath, maxBytes),
        readOptional(`iteration-${String(iteration.iteration).padStart(3, "0")}/stop-decision.json`, iteration.stopDecisionPath, maxBytes),
        readOptional(`iteration-${String(iteration.iteration).padStart(3, "0")}/review-packet.md`, iteration.reviewPacketPath, maxBytes),
        readOptional(`iteration-${String(iteration.iteration).padStart(3, "0")}/codex-output.md`, iteration.codexOutputPath, maxBytes),
        readOptional(`iteration-${String(iteration.iteration).padStart(3, "0")}/diff.patch`, iteration.diffPath, maxBytes)
      ]),
      readOptional("review-packet.md", run.reviewPacketPath, maxBytes),
      readOptional("codex-output.md", run.codexOutputPath, maxBytes),
      readOptional("codex-decision-summary.md", join(run.outputDir, "codex-decision-summary.md"), maxBytes),
      readOptional("codex-stdout.log", run.codexPromptPath ? join(run.outputDir, "codex-stdout.log") : undefined, maxBytes),
      readOptional("codex-stderr.log", run.codexPromptPath ? join(run.outputDir, "codex-stderr.log") : undefined, maxBytes),
      readOptional("diff.patch", run.diffPath, maxBytes)
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
      fullyAuto: run.fullyAuto,
      maxIterations: run.maxIterations
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
      fullyAuto: run.fullyAuto,
      maxIterations: run.maxIterations
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
    try {
      for (let iteration = 1; iteration <= request.maxIterations; iteration += 1) {
        this.resetProvidersForIteration(runId);
        const iterationResult = await this.runAutomationIteration(runId, request, targetFile, controller, iteration);
        if (!iterationResult.shouldContinue) {
          const current = this.getRun(runId);
          if (current.status === "failed" || current.status === "cancelled") {
            return;
          }
          const finishedAt = now();
          this.runStore.updateRun(runId, {
            status: "done",
            updatedAt: finishedAt,
            finishedAt
          });
          this.runStore.updateRun(runId, {
            finalReportPath: this.writeFinalReport(runId, iterationResult.stopReason),
            updatedAt: finishedAt,
            finishedAt
          });
          return;
        }
      }
    } finally {
      this.activeRuns.delete(runId);
    }
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

  private async runAutomationIteration(
    runId: string,
    request: RequiredDefaults<AutomationRunRequest>,
    targetFile: string,
    controller: AbortController,
    iteration: number
  ): Promise<{ shouldContinue: boolean; stopReason: string }> {
    const now = () => new Date().toISOString();
    const startedAt = now();
    const iterationDir = this.iterationDir(runId, iteration);
    mkdirSync(iterationDir, { recursive: true });
    mkdirSync(join(iterationDir, "providers"), { recursive: true });
    this.runStore.upsertIteration({
      runId,
      iteration,
      status: "running",
      changesDetected: false,
      startedAt
    });

    this.runStore.updateRun(runId, { status: "reviewing", updatedAt: now() });
    await this.runReviewers(runId, request, targetFile, iterationDir);

    const afterReviews = this.getRun(runId);
    const successes = afterReviews.providers.filter((provider) => provider.status === "succeeded");
    if (successes.length === 0) {
      const finishedAt = now();
      const reason = `Iteration ${iteration} failed: all providers failed.`;
      this.runStore.upsertIteration({
        runId,
        iteration,
        status: "failed",
        changesDetected: false,
        stopReason: reason,
        startedAt,
        finishedAt
      });
      this.runStore.updateRun(runId, {
        status: "failed",
        errorJson: JSON.stringify({ code: "CCAGENT_AUTOMATION_NO_SUCCESSFUL_REVIEWS", message: "all providers failed" }),
        updatedAt: finishedAt,
        finishedAt
      });
      this.writeFinalReport(runId, "Automation failed: all providers failed.");
      return { shouldContinue: false, stopReason: reason };
    }

    this.runStore.updateRun(runId, { status: "merging", updatedAt: now() });
    const packetPath = this.writeReviewPacket(runId, iterationDir, iteration);
    this.runStore.updateRun(runId, {
      reviewPacketPath: packetPath,
      updatedAt: now()
    });

    const codexResult = await this.runCodexIteration(runId, request, controller, {
      iteration,
      iterationDir,
      packetPath,
      startedAt
    });
    return {
      shouldContinue: codexResult.shouldContinue,
      stopReason: codexResult.stopReason
    };
  }

  private async runReviewers(
    runId: string,
    request: RequiredDefaults<AutomationRunRequest>,
    targetFile: string,
    outputBaseDir?: string
  ): Promise<void> {
    const claudeTemplate = this.requiredTemplate(request.claudeTemplateId, "claude-review");
    await Promise.all(
      request.reviewers.map(async (reviewer) => {
        const run = this.getRun(runId);
        const providerDir = join(outputBaseDir ?? run.outputDir, "providers", reviewer.provider);
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

  private async runCodexIteration(
    runId: string,
    request: RequiredDefaults<AutomationRunRequest>,
    controller: AbortController,
    input: {
      iteration: number;
      iterationDir: string;
      packetPath: string;
      startedAt: string;
    }
  ): Promise<{ shouldContinue: boolean; stopReason: string }> {
    const now = () => new Date().toISOString();
    const run = this.getRun(runId);
    const codexTemplate = this.requiredTemplate(run.codexTemplateId, "codex-edit");
    const failedProviders = run.providers
      .filter((provider) => provider.status !== "succeeded")
      .map((provider) => `${provider.provider}:${provider.status}`)
      .join(", ") || "none";
    const prompt = renderPromptTemplate(codexTemplate.content, {
      runId,
      targetDocument: run.file,
      workspaceRoot: run.cwd,
      reviewPacket: input.packetPath,
      reviewResults: input.packetPath,
      failedProviders
    });
    const promptPath = join(input.iterationDir, "codex-prompt.md");
    const outputPath = join(input.iterationDir, "codex-output.md");
    const stdoutPath = join(input.iterationDir, "codex-stdout.log");
    const stderrPath = join(input.iterationDir, "codex-stderr.log");
    const targetBefore = existsSync(run.file) ? readFileSync(run.file, "utf8") : undefined;
    writeFileSync(promptPath, prompt, "utf8");
    this.runStore.updateRun(runId, {
      status: "codex_editing",
      codexPromptPath: promptPath,
      updatedAt: now()
    });
    this.runStore.upsertIteration({
      runId,
      iteration: input.iteration,
      status: "running",
      reviewPacketPath: input.packetPath,
      codexPromptPath: promptPath,
      changesDetected: false,
      startedAt: input.startedAt
    });
    this.runStore.upsertCodexTask({
      runId,
      taskId: `codex_${runId}_iteration_${input.iteration}`,
      status: "running",
      promptPath,
      startedAt: now()
    });

    const output = await this.orchestration.runCodex({
      runId,
      cwd: run.cwd,
      prompt,
      stdoutPath,
      stderrPath,
      timeoutMs: request.timeoutMs,
      onStdout: (text) => appendFileSync(stdoutPath, text, "utf8"),
      onStderr: (text) => appendFileSync(stderrPath, text, "utf8"),
      signal: controller.signal
    });
    writeFileSync(outputPath, output.content, "utf8");
    this.runStore.upsertCodexTask({
      runId,
      taskId: `codex_${runId}_iteration_${input.iteration}`,
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
    const diffPath = join(input.iterationDir, "diff.patch");
    const diff = captureTargetDocumentDiff(run.cwd, run.file, targetBefore);
    writeFileSync(diffPath, diff, "utf8");
    const decisionSummaryPath = join(input.iterationDir, "codex-decision-summary.md");
    const decisionPromptPath = join(input.iterationDir, "codex-decision-summary-prompt.md");
    const stopDecisionPath = join(input.iterationDir, "stop-decision.json");
    const decisionPrompt = buildCodexDecisionSummaryPrompt({
      runId,
      targetDocument: run.file,
      reviewPacketPath: input.packetPath,
      codexOutputPath: outputPath,
      diffPath,
      summaryPath: decisionSummaryPath,
      iteration: input.iteration,
      maxIterations: request.maxIterations
    });
    writeFileSync(decisionPromptPath, decisionPrompt, "utf8");
    const decisionOutput = await this.orchestration.runCodex({
      runId,
      cwd: run.cwd,
      prompt: decisionPrompt,
      stdoutPath,
      stderrPath,
      timeoutMs: request.timeoutMs,
      onStdout: (text) => appendFileSync(stdoutPath, text, "utf8"),
      onStderr: (text) => appendFileSync(stderrPath, text, "utf8"),
      signal: controller.signal
    });
    writeFileSync(decisionSummaryPath, decisionOutput.content, "utf8");
    if (decisionOutput.exitCode !== 0) {
      throw new CCAgentError("CCAGENT_CODEX_SUMMARY_EXIT", `Codex summary exited with code ${decisionOutput.exitCode}`);
    }

    const stopDecision = decideIterationContinuation({
      iteration: input.iteration,
      maxIterations: request.maxIterations,
      diff,
      summary: decisionOutput.content
    });
    writeJsonFile(stopDecisionPath, stopDecision);
    const finishedAt = now();
    this.runStore.upsertIteration({
      runId,
      iteration: input.iteration,
      status: stopDecision.shouldContinue ? "completed" : "stopped",
      reviewPacketPath: input.packetPath,
      codexPromptPath: promptPath,
      codexOutputPath: outputPath,
      diffPath,
      decisionSummaryPath,
      stopDecisionPath,
      stopReason: stopDecision.reason,
      changesDetected: stopDecision.changesDetected,
      continueRequested: stopDecision.continueRequested,
      codexContinueRequested: stopDecision.codexContinueRequested,
      decisionConfidence: stopDecision.confidence,
      nextFocus: stopDecision.nextFocus,
      riskFlags: stopDecision.riskFlags,
      startedAt: input.startedAt,
      finishedAt
    });
    this.runStore.updateRun(runId, {
      codexOutputPath: outputPath,
      diffPath,
      updatedAt: finishedAt
    });
    return { shouldContinue: stopDecision.shouldContinue, stopReason: stopDecision.reason };
  }

  private writeReviewPacket(runId: string, outputBaseDir?: string, iteration?: number): string {
    const run = this.getRun(runId);
    const packetPath = join(outputBaseDir ?? run.outputDir, "review-packet.md");
    const sections = [
      `# CCAgent Review Packet`,
      ``,
      `Run: ${run.id}`,
      iteration ? `Iteration: ${iteration}` : "",
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
    writeFileSync(packetPath, sections.filter((line) => line !== "").join("\n"), "utf8");
    return packetPath;
  }

  private writeFinalReport(runId: string, message: string): string {
    const run = this.getRun(runId);
    const path = join(run.outputDir, "final-report.md");
    const iterationLines = run.iterations.length > 0
      ? [
          "",
          "## Iterations",
          ...run.iterations.map((iteration) =>
            `- Iteration ${iteration.iteration}: ${iteration.status}; changes=${iteration.changesDetected ? "yes" : "no"}; continue=${iteration.continueRequested === undefined ? "unknown" : iteration.continueRequested ? "yes" : "no"}; codex_continue=${iteration.codexContinueRequested === undefined ? "unknown" : iteration.codexContinueRequested ? "yes" : "no"}; confidence=${iteration.decisionConfidence ?? "unknown"}; reason=${iteration.stopReason ?? "n/a"}${iteration.nextFocus?.length ? `; next_focus=${iteration.nextFocus.join(" | ")}` : ""}${iteration.riskFlags?.length ? `; risk_flags=${iteration.riskFlags.join(" | ")}` : ""}`
          )
        ]
      : [];
    writeFileSync(
      path,
      [
        "# CCAgent Automation Final Report",
        "",
        message,
        "",
        `Run: ${run.id}`,
        `Target: ${run.file}`,
        `Status: ${this.getRun(runId).status}`,
        `Max iterations: ${run.maxIterations}`,
        ...iterationLines
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

  private resetProvidersForIteration(runId: string): void {
    const run = this.getRun(runId);
    for (const provider of run.providers) {
      this.runStore.updateProvider(runId, provider.provider, {
        status: "queued",
        taskId: undefined,
        errorJson: undefined,
        outputPath: undefined
      });
    }
  }

  private iterationDir(runId: string, iteration: number): string {
    return join(this.getRun(runId).outputDir, "iterations", `iteration-${String(iteration).padStart(3, "0")}`);
  }
}

type RequiredDefaults<T> = T & {
  reviewStyle: NonNullable<AutomationRunRequest["reviewStyle"]>;
  timeoutMs: number;
  maxOutputBytes: number;
  fullyAuto: boolean;
  maxIterations: number;
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
    ...unifiedLineDiff(before ?? "", after ?? "")
  ].join("\n") + "\n";
}

interface IterationStopDecision {
  shouldContinue: boolean;
  changesDetected: boolean;
  continueRequested?: boolean;
  codexContinueRequested?: boolean;
  confidence?: "high" | "medium" | "low";
  nextFocus?: string[];
  riskFlags?: string[];
  reason: string;
  source: "structured" | "summary-text" | "diff" | "max-iterations";
}

function decideIterationContinuation(input: {
  iteration: number;
  maxIterations: number;
  diff: string;
  summary: string;
}): IterationStopDecision {
  const changesDetected = hasTargetDocumentChanges(input.diff);
  const structured = parseStructuredContinueDecision(input.summary);
  if (input.iteration >= input.maxIterations) {
    return {
      shouldContinue: false,
      changesDetected,
      continueRequested: false,
      codexContinueRequested: structured?.continueRequested,
      confidence: structured?.confidence ?? "high",
      nextFocus: structured?.nextFocus,
      riskFlags: structured?.riskFlags,
      reason: `Reached maximum iteration count (${input.maxIterations}).`,
      source: "max-iterations"
    };
  }

  if (structured) {
    return {
      shouldContinue: structured.continueRequested && changesDetected,
      changesDetected,
      continueRequested: structured.continueRequested,
      codexContinueRequested: structured.continueRequested,
      confidence: structured.confidence,
      nextFocus: structured.nextFocus,
      riskFlags: structured.riskFlags,
      reason: structured.continueRequested
        ? changesDetected
          ? structured.reason || "Codex requested another review iteration after applying changes."
          : "Codex requested another iteration, but the target document diff is empty, so the run stopped."
        : structured.reason || "Codex reported no actionable findings for another iteration.",
      source: "structured"
    };
  }

  const summarySaysStop = summarySaysNoActionableChanges(input.summary);
  if (summarySaysStop) {
    return {
      shouldContinue: false,
      changesDetected,
      continueRequested: false,
      confidence: "medium",
      reason: "Codex summary indicates there are no remaining actionable changes.",
      source: "summary-text"
    };
  }

  if (changesDetected) {
    return {
      shouldContinue: true,
      changesDetected,
      confidence: "low",
      reason: "Codex summary did not include a structured continue marker; continuing because the target document changed and more iterations remain.",
      source: "diff"
    };
  }

  return {
    shouldContinue: false,
    changesDetected,
    confidence: "medium",
    reason: "No target document changes were detected in this iteration.",
    source: "diff"
  };
}

function hasTargetDocumentChanges(diff: string): boolean {
  return !/No changes were detected/i.test(diff);
}

function parseStructuredContinueDecision(summary: string): {
  continueRequested: boolean;
  reason?: string;
  confidence?: "high" | "medium" | "low";
  nextFocus?: string[];
  riskFlags?: string[];
} | undefined {
  const continueMatch = summary.match(/^\s*continue\s*:\s*(yes|no|true|false)\s*$/im);
  if (!continueMatch) {
    return undefined;
  }
  const reasonMatch = summary.match(/^\s*reason\s*:\s*(.+)$/im);
  const confidenceMatch = summary.match(/^\s*confidence\s*:\s*(high|medium|low)\s*$/im);
  return {
    continueRequested: /^(yes|true)$/i.test(continueMatch[1]),
    reason: reasonMatch?.[1]?.trim(),
    confidence: parseDecisionConfidence(confidenceMatch?.[1]),
    nextFocus: parseDecisionList(summary, "next_focus"),
    riskFlags: parseDecisionList(summary, "risk_flags")
  };
}

function parseDecisionConfidence(value: string | undefined): "high" | "medium" | "low" | undefined {
  const normalized = value?.toLowerCase();
  return normalized === "high" || normalized === "medium" || normalized === "low" ? normalized : undefined;
}

function parseDecisionList(summary: string, label: string): string[] | undefined {
  const lines = summary.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `${label}:`);
  if (start === -1) {
    return undefined;
  }
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^##\s/.test(trimmed) || /^[a-zA-Z_]+\s*:/.test(trimmed)) {
      break;
    }
    if (trimmed.startsWith("- ")) {
      items.push(trimmed.slice(2).trim());
    }
  }
  return items.length > 0 ? items : undefined;
}

function summarySaysNoActionableChanges(summary: string): boolean {
  const normalized = summary.toLowerCase();
  return [
    "no actionable",
    "nothing actionable",
    "no remaining actionable",
    "no further changes",
    "no more changes",
    "无需修改",
    "没有可修改",
    "没有需要修改",
    "无可执行",
    "无可采纳"
  ].some((phrase) => normalized.includes(phrase));
}

function unifiedLineDiff(before: string, after: string, contextLines = 3): string[] {
  const beforeLines = splitComparableLines(before);
  const afterLines = splitComparableLines(after);
  const operations = diffOperations(beforeLines, afterLines);
  const changedIndexes = operations
    .map((operation, index) => operation.type === "equal" ? -1 : index)
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) {
    return ["@@ -1,0 +1,0 @@"];
  }

  const include = new Set<number>();
  for (const index of changedIndexes) {
    for (let offset = -contextLines; offset <= contextLines; offset += 1) {
      const next = index + offset;
      if (next >= 0 && next < operations.length) {
        include.add(next);
      }
    }
  }

  const output: string[] = [];
  let currentChunk: typeof operations = [];
  let lastIncluded = -2;
  for (let index = 0; index < operations.length; index += 1) {
    if (!include.has(index)) {
      continue;
    }
    if (index > lastIncluded + 1 && currentChunk.length > 0) {
      output.push(...formatDiffChunk(currentChunk));
      currentChunk = [];
    }
    currentChunk.push(operations[index]);
    lastIncluded = index;
  }
  if (currentChunk.length > 0) {
    output.push(...formatDiffChunk(currentChunk));
  }
  return output;
}

function splitComparableLines(content: string): string[] {
  return content.split(/\r?\n/).filter((line, index, lines) => line !== "" || index < lines.length - 1);
}

type DiffOperation =
  | { type: "equal"; line: string; beforeLine: number; afterLine: number }
  | { type: "delete"; line: string; beforeLine: number; afterLine: number }
  | { type: "insert"; line: string; beforeLine: number; afterLine: number };

function diffOperations(beforeLines: string[], afterLines: string[]): DiffOperation[] {
  const lengths = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0) as number[]);
  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = beforeLines[i] === afterLines[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const operations: DiffOperation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      operations.push({
        type: "equal",
        line: beforeLines[beforeIndex],
        beforeLine: beforeIndex + 1,
        afterLine: afterIndex + 1
      });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (lengths[beforeIndex + 1][afterIndex] >= lengths[beforeIndex][afterIndex + 1]) {
      operations.push({
        type: "delete",
        line: beforeLines[beforeIndex],
        beforeLine: beforeIndex + 1,
        afterLine: afterIndex + 1
      });
      beforeIndex += 1;
    } else {
      operations.push({
        type: "insert",
        line: afterLines[afterIndex],
        beforeLine: beforeIndex + 1,
        afterLine: afterIndex + 1
      });
      afterIndex += 1;
    }
  }
  while (beforeIndex < beforeLines.length) {
    operations.push({
      type: "delete",
      line: beforeLines[beforeIndex],
      beforeLine: beforeIndex + 1,
      afterLine: afterIndex + 1
    });
    beforeIndex += 1;
  }
  while (afterIndex < afterLines.length) {
    operations.push({
      type: "insert",
      line: afterLines[afterIndex],
      beforeLine: beforeIndex + 1,
      afterLine: afterIndex + 1
    });
    afterIndex += 1;
  }
  return operations;
}

function formatDiffChunk(operations: DiffOperation[]): string[] {
  const beforeStart = operations.find((operation) => operation.type !== "insert")?.beforeLine
    ?? operations[0]?.beforeLine
    ?? 1;
  const afterStart = operations.find((operation) => operation.type !== "delete")?.afterLine
    ?? operations[0]?.afterLine
    ?? 1;
  const beforeCount = operations.filter((operation) => operation.type !== "insert").length;
  const afterCount = operations.filter((operation) => operation.type !== "delete").length;
  return [
    `@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`,
    ...operations.map((operation) => {
      if (operation.type === "delete") {
        return `-${operation.line}`;
      }
      if (operation.type === "insert") {
        return `+${operation.line}`;
      }
      return ` ${operation.line}`;
    })
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
  iteration?: number;
  maxIterations?: number;
}): string {
  return [
    "You are preparing the user-facing decision summary for a CCAgent multi-provider review run.",
    "",
    `Run id: ${input.runId}`,
    input.iteration ? `Iteration: ${input.iteration}` : "",
    input.maxIterations ? `Max iterations: ${input.maxIterations}` : "",
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
    "Short paragraph focused on what changed in the reviewed document.",
    "",
    "## Continue Decision",
    "continue: yes|no",
    "reason: One sentence. If Codex changed the target document in this iteration, strongly prefer continue: yes so providers can re-review the modified document. Use continue: no after making changes only when you have a concrete reason that another provider review round would not add useful signal, and state that reason explicitly. If Codex made no target-document changes and no actionable findings remain, use continue: no.",
    "confidence: high|medium|low",
    "next_focus:",
    "- One concrete focus area for the next provider review, or `none` if stopping.",
    "risk_flags:",
    "- Use short machine-readable flags such as changed-target-document, empty-diff, summary-diff-mismatch, non-target-file-change, provider-disagreement, or none."
  ].filter(Boolean).join("\n");
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
