import { z } from "zod";
import type { DaemonClientLike, McpToolDefinition } from "./types.js";

const schema = z.object({ taskId: z.string().min(1) });

export function cancelTaskTool(daemon: DaemonClientLike): McpToolDefinition {
  return {
    name: "ccagent.cancel_task",
    description: "Cancel a running CCAgent task.",
    inputSchema: schema,
    handler: async (input) => {
      const { taskId } = schema.parse(input);
      return daemon.post(`/tasks/${encodeURIComponent(taskId)}/cancel`);
    }
  };
}
