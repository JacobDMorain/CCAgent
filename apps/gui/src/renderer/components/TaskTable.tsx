import type { GuiTaskRecord } from "../types.js";
import { parseErrorMessage } from "../guiLogic.js";

export interface TaskTableProps {
  tasks: GuiTaskRecord[];
  onCancel?(taskId: string): void | Promise<void>;
  onReadOutput?(taskId: string): void | Promise<void>;
}

export function TaskTable({ tasks, onCancel, onReadOutput }: TaskTableProps) {
  return (
    <table className="task-table">
      <thead>
        <tr>
          <th>Task id</th>
          <th>Status</th>
          <th>Provider</th>
          <th>Model</th>
          <th>CWD</th>
          <th>Started</th>
          <th>Duration</th>
          <th>Output preview</th>
          <th>Cancel</th>
          <th>Output</th>
        </tr>
      </thead>
      <tbody>
        {tasks.length === 0 ? (
          <tr>
            <td colSpan={10}>No tasks</td>
          </tr>
        ) : (
          tasks.map((task) => (
            <tr key={task.id} className={`status-${task.status}`}>
              <td>{task.id}</td>
              <td>{task.status}</td>
              <td>{task.provider}</td>
              <td>{task.model}</td>
              <td>{task.cwd}</td>
              <td>{task.startedAt}</td>
              <td>{formatDuration(task.durationMs)}</td>
              <td>{task.status === "error" ? parseErrorMessage(task.errorJson) : task.content ?? task.summary ?? ""}</td>
              <td>
                {task.status === "running" ? (
                  <button type="button" onClick={() => void onCancel?.(task.id)}>
                    Cancel
                  </button>
                ) : null}
              </td>
              <td>
                <button type="button" onClick={() => void onReadOutput?.(task.id)}>
                  View output
                </button>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function formatDuration(durationMs?: number): string {
  return durationMs === undefined ? "" : `${durationMs} ms`;
}
