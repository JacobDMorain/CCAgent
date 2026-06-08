import { z } from "zod";
import type { DaemonClientLike, McpToolDefinition } from "./types.js";

const schema = z.object({});

export function listProvidersTool(daemon: DaemonClientLike): McpToolDefinition {
  return {
    name: "ccagent.list_providers",
    description: "List configured CCAgent providers.",
    inputSchema: schema,
    handler: async () => daemon.get("/providers")
  };
}
