import type { AutomationRunRecord } from "@ccagent/core";
import type { Translator } from "../i18n.js";
import type { RunDecisionDetails } from "../guiLogic.js";

export interface RunsPageProps {
  t: Translator;
  runs: AutomationRunRecord[];
  selectedOutput?: string;
  selectedOutputRunId?: string;
  selectedStatus?: RunDecisionDetails;
  selectedStatusRunId?: string;
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
  onCancel,
  onShowStatus,
  onSelectStatusIteration,
  onReadOutput,
  onDelete
}: RunsPageProps) {
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
            <th>{t("cancel")}</th>
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
              <td>
                <button type="button" onClick={() => void onCancel(run.id)}>{t("cancel")}</button>
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

function iterationSummary(run: AutomationRunRecord): string {
  if (run.iterations.length === 0) {
    return `0 / ${run.maxIterations}`;
  }
  const latest = run.iterations[run.iterations.length - 1];
  const reason = latest.stopReason ? `: ${latest.stopReason}` : "";
  return `${latest.iteration} / ${run.maxIterations} ${latest.status}${reason}`;
}
