import { useMemo, useState } from "react";
import { TaskTable } from "../components/TaskTable.js";
import type { GuiTaskRecord } from "../types.js";

export interface TasksPageProps {
  tasks: GuiTaskRecord[];
  selectedOutput?: string;
  selectedOutputTaskId?: string;
  onCancelTask?(taskId: string): void | Promise<void>;
  onReadTaskOutput?(taskId: string): void | Promise<void>;
  onClearTasks?(): void | Promise<void>;
}

export function TasksPage({
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
          <h2>Tasks</h2>
          <p>{expanded ? "Showing tasks from the last 3 days" : "Showing the 3 most recent tasks"}</p>
        </div>
        <div className="button-row inline-row">
          <button type="button" onClick={() => setExpanded((current) => !current)}>
            {expanded ? "Collapse" : "Expand"}
          </button>
          <button type="button" onClick={() => void onClearTasks?.()}>
            Clear history
          </button>
        </div>
      </header>
      <TaskTable
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
