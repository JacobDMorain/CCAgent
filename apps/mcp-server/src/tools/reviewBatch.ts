import { ReviewBatchRequestSchema } from "@ccagent/core";
import { z } from "zod";
import type { DaemonClientLike, McpToolDefinition } from "./types.js";

const batchIdSchema = z.object({
  batchId: z.string().min(1)
});

const readBatchOutputSchema = batchIdSchema.extend({
  maxBytes: z.number().int().min(1).optional()
});

export function reviewFileMultiTool(daemon: DaemonClientLike): McpToolDefinition {
  return {
    name: "ccagent.review_file_multi",
    description: "Review one local file with multiple CCAgent providers in parallel.",
    inputSchema: ReviewBatchRequestSchema,
    handler: async (input) => daemon.post("/review-batches", ReviewBatchRequestSchema.parse(input))
  };
}

export function getReviewBatchStatusTool(daemon: DaemonClientLike): McpToolDefinition {
  return {
    name: "ccagent.get_review_batch_status",
    description: "Get aggregate status for a multi-provider review batch.",
    inputSchema: batchIdSchema,
    handler: async (input) => {
      const { batchId } = batchIdSchema.parse(input);
      return daemon.get(`/review-batches/${encodeURIComponent(batchId)}`);
    }
  };
}

export function readReviewBatchOutputTool(daemon: DaemonClientLike): McpToolDefinition {
  return {
    name: "ccagent.read_review_batch_output",
    description: "Read and summarize outputs for a multi-provider review batch.",
    inputSchema: readBatchOutputSchema,
    handler: async (input) => {
      const { batchId, maxBytes } = readBatchOutputSchema.parse(input);
      const suffix = maxBytes === undefined ? "" : `?maxBytes=${maxBytes}`;
      return daemon.get(`/review-batches/${encodeURIComponent(batchId)}/output${suffix}`);
    }
  };
}
