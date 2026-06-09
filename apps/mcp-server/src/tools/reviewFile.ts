import { buildReviewFilePrompt, ReviewFileRequestSchema } from "@ccagent/core";
import type { DaemonClientLike, McpToolDefinition } from "./types.js";

export function reviewFileTool(daemon: DaemonClientLike): McpToolDefinition {
  return {
    name: "ccagent.review_file",
    description: "Review a local file with a selected CCAgent provider.",
    inputSchema: ReviewFileRequestSchema,
    handler: async (input) => {
      const request = ReviewFileRequestSchema.parse(input);
      return daemon.post("/tasks", {
        provider: request.provider,
        model: request.model,
        cwd: request.cwd,
        prompt: buildReviewFilePrompt(request),
        files: [request.file],
        mode: request.mode,
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes
      });
    }
  };
}
