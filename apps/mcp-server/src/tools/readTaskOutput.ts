import { z } from "zod";
import type { DaemonClientLike, McpToolDefinition } from "./types.js";

const schema = z.object({
  taskId: z.string().min(1),
  maxBytes: z.number().int().min(1).optional()
});

export function readTaskOutputTool(daemon: DaemonClientLike): McpToolDefinition {
  return {
    name: "ccagent.read_task_output",
    description: "Read CCAgent task output.",
    inputSchema: schema,
    handler: async (input) => {
      const { taskId, maxBytes } = schema.parse(input);
      const suffix = maxBytes === undefined ? "" : `?maxBytes=${maxBytes}`;
      return daemon.get(`/tasks/${encodeURIComponent(taskId)}/output${suffix}`);
    }
  };
}
