import { TaskTable } from "../components/TaskTable.js";
import type { GuiTaskRecord } from "../types.js";

export interface TasksPageProps {
  tasks: GuiTaskRecord[];
  selectedOutput?: string;
  onCancelTask?(taskId: string): void | Promise<void>;
  onReadTaskOutput?(taskId: string): void | Promise<void>;
}

export function TasksPage({ tasks, selectedOutput, onCancelTask, onReadTaskOutput }: TasksPageProps) {
  return (
    <section className="page-section" id="tasks">
      <header>
        <h2>Tasks</h2>
      </header>
      <TaskTable tasks={tasks} onCancel={onCancelTask} onReadOutput={onReadTaskOutput} />
      {selectedOutput ? <pre className="output-viewer">{selectedOutput}</pre> : null}
    </section>
  );
}
