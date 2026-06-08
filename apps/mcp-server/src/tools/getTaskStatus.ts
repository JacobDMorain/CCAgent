import { z } from "zod";
import type { DaemonClientLike, McpToolDefinition } from "./types.js";

const schema = z.object({ taskId: z.string().min(1) });

export function getTaskStatusTool(daemon: DaemonClientLike): McpToolDefinition {
  return {
    name: "ccagent.get_task_status",
    description: "Get CCAgent task status.",
    inputSchema: schema,
    handler: async (input) => {
      const { taskId } = schema.parse(input);
      return daemon.get(`/tasks/${encodeURIComponent(taskId)}`);
    }
  };
}
