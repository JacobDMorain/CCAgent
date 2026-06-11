import type { AutomationRunRecord } from "@ccagent/core";
import type { Translator } from "../i18n.js";
import type { RunDecisionDetails } from "../guiLogic.js";
import { useEffect, useState } from "react";

export interface RunsPageProps {
  t: Translator;
  runs: AutomationRunRecord[];
  selectedOutput?: string;
  selectedOutputRunId?: string;
  selectedStatus?: RunDecisionDetails;
  selectedStatusRunId?: string;
  nowMs?: number;
  onCancel(runId: string): void | Promise<void>;
  onShowStatus(run: AutomationRunRecord): void | Promise<void>;
  onSelectStatusIteration(runId: string, iteration: number | undefined): void;
  onReadOutput(runId: string): void | Promise<void>;
  onDelete(runId: string): void | Promise<void>;
}

export function RunsPage({
  t,
  runs,
  selectedOutput,
  selectedOutputRunId,
  selectedStatus,
  selectedStatusRunId,
  nowMs,
  onCancel,
  onShowStatus,
  onSelectStatusIteration,
  onReadOutput,
  onDelete
}: RunsPageProps) {
  const [clockMs, setClockMs] = useState(() => nowMs ?? Date.now());
  useEffect(() => {
    if (nowMs !== undefined) {
      setClockMs(nowMs);
      return undefined;
    }
    const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [nowMs]);
  return (
    <section className="page-section" id="runs">
      <header>
        <h2>{t("runsTitle")}</h2>
      </header>
      <table className="task-table">
        <thead>
          <tr>
            <th>{t("runId")}</th>
            <th>{t("status")}</th>
            <th>{t("target")}</th>
            <th>{t("providers")}</th>
            <th>{t("iterations")}</th>
            <th>{t("started")}</th>
            <th>{t("phase")}</th>
            <th>{t("cli")}</th>
            <th>{t("elapsed")}</th>
            <th>{t("terminateCli")}</th>
            <th>{t("status")}</th>
            <th>{t("output")}</th>
            <th>{t("delete")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className={run.status === "failed" ? "status-error" : undefined}>
              <td title={run.id}>{run.id}</td>
              <td>{run.status}</td>
              <td title={run.file}>{run.file}</td>
              <td>{providerSummary(run, t)}</td>
              <td>{iterationSummary(run)}</td>
              <td>{run.createdAt}</td>
              <td>{phaseLabel(run, t)}</td>
              <td>{cliStatus(run, t)}</td>
              <td>{elapsedLabel(run, clockMs)}</td>
              <td>
                <button type="button" disabled={!isRunActive(run)} onClick={() => void onCancel(run.id)}>
                  {isRunActive(run) ? t("terminateCli") : t("cancel")}
                </button>
              </td>
              <td>
                <button type="button" onClick={() => onShowStatus(run)}>{t("status")}</button>
              </td>
              <td>
                <button type="button" onClick={() => void onReadOutput(run.id)}>
                  {selectedOutputRunId === run.id ? t("hide") : t("read")}
                </button>
              </td>
              <td>
                <button type="button" onClick={() => void onDelete(run.id)}>{t("delete")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {selectedStatusRunId && selectedStatus ? (
        <RunStatusViewer
          details={selectedStatus}
          runId={selectedStatusRunId}
          onSelectIteration={onSelectStatusIteration}
        />
      ) : null}
      {selectedOutputRunId && selectedOutput ? <pre className="output-viewer">{selectedOutput}</pre> : null}
    </section>
  );
}

function RunStatusViewer({
  details,
  runId,
  onSelectIteration
}: {
  details: RunDecisionDetails;
  runId: string;
  onSelectIteration(runId: string, iteration: number | undefined): void;
}) {
  const selectedIteration = details.selectedIteration;
  const selectedDetail = details.iterations.find((item) => item.iteration === selectedIteration);
  const content = selectedDetail?.content ?? details.overview;

  return (
    <div className="status-viewer">
      <div className="status-tabs">
        <button
          type="button"
          className={selectedIteration === undefined ? "selected" : undefined}
          onClick={() => onSelectIteration(runId, undefined)}
        >
          Overview
        </button>
        {details.iterations.map((iteration) => (
          <button
            type="button"
            key={iteration.iteration}
            className={selectedIteration === iteration.iteration ? "selected" : undefined}
            onClick={() => onSelectIteration(runId, iteration.iteration)}
          >
            {iteration.label}
          </button>
        ))}
      </div>
      <pre className="output-viewer">{content}</pre>
      {selectedDetail?.warnings?.length ? (
        <div className="status-warning">
          {selectedDetail.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function providerSummary(run: AutomationRunRecord, t: Translator): string {
  const succeeded = run.providers.filter((provider) => provider.status === "succeeded").length;
  const failed = run.providers.filter((provider) => provider.status !== "succeeded").length;
  return t("providerSummary", { succeeded, failed });
}

function phaseLabel(run: AutomationRunRecord, t: Translator): string {
  if (run.status === "reviewing") {
    return t("phaseReviewing");
  }
  if (run.status === "merging") {
    return t("phaseMerging");
  }
  if (run.status === "codex_editing") {
    return t("phaseCodexEditing");
  }
  if (run.status === "verifying") {
    return t("phaseVerifying");
  }
  if (run.status === "done") {
    return t("phaseDone");
  }
  if (run.status === "failed") {
    return t("phaseFailed");
  }
  if (run.status === "cancelled") {
    return t("phaseCancelled");
  }
  return run.status;
}

function isRunActive(run: AutomationRunRecord): boolean {
  return ["queued", "reviewing", "merging", "codex_editing", "verifying"].includes(run.status);
}

function cliStatus(run: AutomationRunRecord, t: Translator): string {
  const providerStatus = run.providers
    .map((provider) => `${provider.provider}:${provider.status}`)
    .join(", ");
  if (run.status === "reviewing" && providerStatus) {
    return `${t("claudeCli")}: ${providerStatus}`;
  }
  if (run.codexTask) {
    return `${t("codexCli")}: ${run.codexTask.status} (${run.codexTask.taskId})`;
  }
  if (providerStatus) {
    return `${t("claudeCli")}: ${providerStatus}`;
  }
  return "";
}

function elapsedLabel(run: AutomationRunRecord, nowMs = Date.now()): string {
  const startedAt = activeStartedAt(run);
  if (!startedAt) {
    return "";
  }
  const elapsedMs = Math.max(0, nowMs - Date.parse(startedAt));
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function activeStartedAt(run: AutomationRunRecord): string | undefined {
  const runningProvider = run.providers.find((provider) => provider.status === "running");
  if (runningProvider) {
    return runningProvider.startedAt ?? run.iterations.at(-1)?.startedAt ?? run.createdAt;
  }
  if (run.codexTask?.status === "running") {
    return run.codexTask.startedAt;
  }
  return undefined;
}

function iterationSummary(run: AutomationRunRecord): string {
  if (run.iterations.length === 0) {
    return `0 / ${run.maxIterations}`;
  }
  const latest = run.iterations[run.iterations.length - 1];
  const reason = latest.stopReason ? `: ${latest.stopReason}` : "";
  return `${latest.iteration} / ${run.maxIterations} ${latest.status}${reason}`;
}
