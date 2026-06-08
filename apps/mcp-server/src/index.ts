import { DaemonClient } from "@ccagent/daemon-client";
import { defaultConfigPath, loadSettingsFromFile, mergeSettings } from "@ccagent/daemon";
import { DpapiStore } from "@ccagent/secrets";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { DaemonClientLike, McpToolDefinition } from "./tools/index.js";
import {
  cancelTaskTool,
  getTaskStatusTool,
  listProvidersTool,
  readTaskOutputTool,
  reviewFileTool,
  runTaskTool,
  testProviderTool
} from "./tools/index.js";

export type { DaemonClientLike, McpToolDefinition };

export interface McpServerOptions {
  name?: string;
  version?: string;
}

export function createMcpTools(daemon: DaemonClientLike): Record<string, McpToolDefinition> {
  const tools = [
    listProvidersTool(daemon),
    testProviderTool(daemon),
    runTaskTool(daemon),
    reviewFileTool(daemon),
    getTaskStatusTool(daemon),
    readTaskOutputTool(daemon),
    cancelTaskTool(daemon)
  ];

  return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

export function toMcpToolResult(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  const structuredContent =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { result: value };

  return {
    content: [{ type: "text" as const, text }],
    structuredContent
  };
}

export function registerMcpTools(
  server: Pick<McpServer, "registerTool">,
  tools: Record<string, McpToolDefinition>
): void {
  for (const tool of Object.values(tools)) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema
      },
      async (input) => toMcpToolResult(await tool.handler(input))
    );
  }
}

export function createMcpServer(
  daemon: DaemonClientLike,
  options: McpServerOptions = {}
): McpServer {
  const server = new McpServer({
    name: options.name ?? "ccagent-mcp",
    version: options.version ?? "0.0.0"
  });
  registerMcpTools(server, createMcpTools(daemon));
  return server;
}

export function createDaemonClientFromEnv(env: NodeJS.ProcessEnv = process.env): DaemonClient {
  const settings = mergeSettings(loadSettingsFromFile(env.CCAGENT_CONFIG_PATH ?? defaultConfigPath()));
  return new DaemonClient({
    baseUrl: env.CCAGENT_DAEMON_URL ?? `http://${settings.daemon.host}:${settings.daemon.port}`,
    token: env.CCAGENT_DAEMON_TOKEN ?? readDaemonToken(settings.daemon.authTokenRef)
  });
}

function readDaemonToken(ref: string): string {
  try {
    return new DpapiStore().getSync(ref);
  } catch {
    return "";
  }
}

export async function startStdioServer(
  daemon: DaemonClientLike = createDaemonClientFromEnv()
): Promise<void> {
  const server = createMcpServer(daemon);
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startStdioServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
