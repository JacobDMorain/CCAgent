import { RunTaskRequestSchema } from "@ccagent/core";
import type { DaemonClientLike, McpToolDefinition } from "./types.js";

export function runTaskTool(daemon: DaemonClientLike): McpToolDefinition {
  return {
    name: "ccagent.run_task",
    description: "Run a CCAgent task through the daemon.",
    inputSchema: RunTaskRequestSchema,
    handler: async (input) => daemon.post("/tasks", RunTaskRequestSchema.parse(input))
  };
}
