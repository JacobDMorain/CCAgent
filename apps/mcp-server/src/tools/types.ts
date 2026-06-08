import type { z } from "zod";

export interface DaemonClientLike {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
  delete(path: string): Promise<unknown>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler(input: unknown): Promise<unknown>;
}
