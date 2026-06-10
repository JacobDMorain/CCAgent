import { useMemo, useState } from "react";
import { TaskTable } from "../components/TaskTable.js";
import type { Translator } from "../i18n.js";
import type { GuiTaskRecord } from "../types.js";

export interface TasksPageProps {
  t: Translator;
  tasks: GuiTaskRecord[];
  selectedOutput?: string;
  selectedOutputTaskId?: string;
  onCancelTask?(taskId: string): void | Promise<void>;
  onReadTaskOutput?(taskId: string): void | Promise<void>;
  onClearTasks?(): void | Promise<void>;
}

export function TasksPage({
  t,
  tasks,
  selectedOutput,
  selectedOutputTaskId,
  onCancelTask,
  onReadTaskOutput,
  onClearTasks
}: TasksPageProps) {
  const [expanded, setExpanded] = useState(false);
  const visibleTasks = useMemo(
    () => (expanded ? tasks.filter(isWithinLastThreeDays) : tasks.slice(0, 3)),
    [expanded, tasks]
  );

  return (
    <section className="page-section" id="tasks">
      <header className="section-header">
        <div>
          <h2>{t("tasksTitle")}</h2>
          <p>{expanded ? t("showingLastThreeDays") : t("showingMostRecentTasks")}</p>
        </div>
        <div className="button-row inline-row">
          <button type="button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? t("collapse") : t("expand")}
          </button>
          <button type="button" onClick={() => void onClearTasks?.()}>
            {t("clearHistory")}
          </button>
        </div>
      </header>
      <TaskTable
        t={t}
        tasks={visibleTasks}
        selectedOutputTaskId={selectedOutputTaskId}
        onCancel={onCancelTask}
        onReadOutput={onReadTaskOutput}
      />
      {selectedOutputTaskId && selectedOutput ? <pre className="output-viewer">{selectedOutput}</pre> : null}
    </section>
  );
}

function isWithinLastThreeDays(task: GuiTaskRecord): boolean {
  const startedAt = Date.parse(task.startedAt);
  if (Number.isNaN(startedAt)) {
    return false;
  }

  return startedAt >= Date.now() - 3 * 24 * 60 * 60 * 1000;
}
