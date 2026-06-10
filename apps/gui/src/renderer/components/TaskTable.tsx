import type { GuiTaskRecord } from "../types.js";
import { parseErrorMessage } from "../guiLogic.js";
import { createTranslator, type Translator } from "../i18n.js";

export interface TaskTableProps {
  t?: Translator;
  tasks: GuiTaskRecord[];
  selectedOutputTaskId?: string;
  onCancel?(taskId: string): void | Promise<void>;
  onReadOutput?(taskId: string): void | Promise<void>;
}

export function TaskTable({ t = createTranslator("en"), tasks, selectedOutputTaskId, onCancel, onReadOutput }: TaskTableProps) {
  return (
    <table className="task-table">
      <thead>
        <tr>
          <th>{t("taskId")}</th>
          <th>{t("status")}</th>
          <th>{t("provider")}</th>
          <th>{t("model")}</th>
          <th>{t("cwd")}</th>
          <th>{t("started")}</th>
          <th>{t("duration")}</th>
          <th>{t("outputPreview")}</th>
          <th>{t("cancel")}</th>
          <th>{t("output")}</th>
        </tr>
      </thead>
      <tbody>
        {tasks.length === 0 ? (
          <tr>
            <td colSpan={10}>{t("noTasks")}</td>
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
                    {t("cancel")}
                  </button>
                ) : null}
              </td>
              <td>
                <button type="button" onClick={() => void onReadOutput?.(task.id)}>
                  {selectedOutputTaskId === task.id ? t("hide") : t("read")}
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
