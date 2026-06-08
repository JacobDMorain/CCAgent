import { z } from "zod";
import type { DaemonClientLike, McpToolDefinition } from "./types.js";

const schema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).optional()
});

export function testProviderTool(daemon: DaemonClientLike): McpToolDefinition {
  return {
    name: "ccagent.test_provider",
    description: "Test a configured CCAgent provider.",
    inputSchema: schema,
    handler: async (input) => daemon.post("/providers/test", schema.parse(input))
  };
}
