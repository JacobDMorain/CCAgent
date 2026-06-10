import type { AutomationRunRecord } from "@ccagent/core";

export interface RunsPageProps {
  runs: AutomationRunRecord[];
  selectedOutput?: string;
  selectedOutputRunId?: string;
  selectedStatus?: string;
  selectedStatusRunId?: string;
  onCancel(runId: string): void | Promise<void>;
  onShowStatus(run: AutomationRunRecord): void | Promise<void>;
  onReadOutput(runId: string): void | Promise<void>;
  onDelete(runId: string): void | Promise<void>;
}

export function RunsPage({
  runs,
  selectedOutput,
  selectedOutputRunId,
  selectedStatus,
  selectedStatusRunId,
  onCancel,
  onShowStatus,
  onReadOutput,
  onDelete
}: RunsPageProps) {
  return (
    <section className="page-section" id="runs">
      <header>
        <h2>Runs</h2>
      </header>
      <table className="task-table">
        <thead>
          <tr>
            <th>Run id</th>
            <th>Status</th>
            <th>Target</th>
            <th>Providers</th>
            <th>Iterations</th>
            <th>Started</th>
            <th>Phase</th>
            <th>Cancel</th>
            <th>Status</th>
            <th>Output</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className={run.status === "failed" ? "status-error" : undefined}>
              <td title={run.id}>{run.id}</td>
              <td>{run.status}</td>
              <td title={run.file}>{run.file}</td>
              <td>{providerSummary(run)}</td>
              <td>{iterationSummary(run)}</td>
              <td>{run.createdAt}</td>
              <td>{phaseLabel(run)}</td>
              <td>
                <button type="button" onClick={() => void onCancel(run.id)}>Cancel</button>
              </td>
              <td>
                <button type="button" onClick={() => onShowStatus(run)}>Status</button>
              </td>
              <td>
                <button type="button" onClick={() => void onReadOutput(run.id)}>
                  {selectedOutputRunId === run.id ? "Hide" : "Read"}
                </button>
              </td>
              <td>
                <button type="button" onClick={() => void onDelete(run.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {selectedStatusRunId && selectedStatus ? (
        <pre className="output-viewer">{selectedStatus}</pre>
      ) : null}
      {selectedOutputRunId && selectedOutput ? <pre className="output-viewer">{selectedOutput}</pre> : null}
    </section>
  );
}

function providerSummary(run: AutomationRunRecord): string {
  const succeeded = run.providers.filter((provider) => provider.status === "succeeded").length;
  const failed = run.providers.filter((provider) => provider.status !== "succeeded").length;
  return `${succeeded} ok / ${failed} other`;
}

function phaseLabel(run: AutomationRunRecord): string {
  if (run.status === "reviewing") {
    return "Reviewing";
  }
  if (run.status === "merging") {
    return "Merging reviews";
  }
  if (run.status === "codex_editing") {
    return "Codex editing";
  }
  if (run.status === "verifying") {
    return "Verifying";
  }
  if (run.status === "done") {
    return "Done";
  }
  if (run.status === "failed") {
    return "Failed";
  }
  if (run.status === "cancelled") {
    return "Cancelled";
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
