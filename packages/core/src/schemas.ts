import { z } from "zod";

const providerIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const timeoutSchema = z.number().int().min(1000).max(3600000).default(600000);
const maxOutputBytesSchema = z.number().int().min(1024).max(1048576).default(131072);

export const ProviderConfigSchema = z.object({
  id: providerIdSchema,
  displayName: z.string().min(1),
  mode: z.enum(["anthropic-compatible", "openai-compatible"]),
  baseUrl: z.string().url(),
  apiKeyRef: z.string().min(1),
  auth: z.object({
    header: z.enum(["Authorization", "x-api-key"]),
    scheme: z.enum(["Bearer", "Raw"])
  }),
  models: z.object({
    default: z.string().min(1),
    review: z.string().min(1).optional(),
    fast: z.string().min(1).optional(),
    reasoning: z.string().min(1).optional()
  }),
  capabilities: z.object({
    streaming: z.boolean(),
    tools: z.boolean(),
    systemPrompt: z.boolean(),
    thinking: z.boolean().optional()
  }),
  enabled: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const RunTaskRequestSchema = z.object({
  provider: providerIdSchema,
  model: z.string().min(1).optional(),
  cwd: z.string().min(1),
  prompt: z.string().min(1),
  files: z.array(z.string().min(1)).optional(),
  mode: z.enum(["sync", "async"]).default("sync"),
  timeoutMs: timeoutSchema,
  maxOutputBytes: maxOutputBytesSchema
});

export const ReviewFileRequestSchema = z.object({
  provider: providerIdSchema,
  model: z.string().min(1).optional(),
  cwd: z.string().min(1),
  file: z.string().min(1),
  reviewStyle: z.enum(["bugs", "architecture", "language", "full"]).default("full"),
  language: z.string().min(1).optional(),
  timeoutMs: timeoutSchema,
  maxOutputBytes: maxOutputBytesSchema
});

export const TaskResultSchema = z.object({
  status: z.enum(["ok", "error", "cancelled", "timeout"]),
  taskId: z.string().min(1),
  provider: providerIdSchema,
  model: z.string().min(1),
  cwd: z.string().min(1),
  summary: z.string().optional(),
  content: z.string().optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      detail: z.string().optional()
    })
    .optional(),
  logsRef: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional()
});

export const TaskIdRequestSchema = z.object({
  taskId: z.string().min(1)
});

export const ReadTaskOutputRequestSchema = z.object({
  taskId: z.string().min(1),
  maxBytes: maxOutputBytesSchema
});
