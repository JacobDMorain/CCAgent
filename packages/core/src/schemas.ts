import { z } from "zod";

const providerIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const timeoutSchema = z.number().int().min(1000).max(3600000).default(600000);
const maxOutputBytesSchema = z.number().int().min(1024).max(1048576).default(131072);
const maxIterationsSchema = z.number().int().min(1).max(10).default(1);
const reviewStyleSchema = z.enum(["bugs", "architecture", "language", "full"]);
const reviewBatchReviewerSchema = z.object({
  provider: providerIdSchema,
  model: z.string().min(1).optional(),
  roleIds: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)).optional()
});
const promptTemplateKindSchema = z.enum(["claude-review", "codex-edit"]);

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
  reviewStyle: reviewStyleSchema.default("full"),
  language: z.string().min(1).optional(),
  mode: z.enum(["sync", "async"]).default("sync"),
  timeoutMs: timeoutSchema,
  maxOutputBytes: maxOutputBytesSchema
});

export const ReviewBatchRequestSchema = z.object({
  cwd: z.string().min(1),
  file: z.string().min(1),
  reviewStyle: reviewStyleSchema.default("full"),
  language: z.string().min(1).optional(),
  reviewers: z.array(reviewBatchReviewerSchema).min(1),
  timeoutMs: timeoutSchema,
  maxOutputBytes: maxOutputBytesSchema
});

export const PromptTemplateSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  kind: promptTemplateKindSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.number().int().min(1),
  content: z.string().min(1),
  requiredVariables: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/)),
  isDefault: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

const legacyRoleGroupById: Record<string, string> = {
  "document-structure": "documentation-quality",
  "fact-consistency": "documentation-quality",
  actionability: "product-delivery",
  "risk-opposition": "risk-opposition",
  "language-expression": "user-perspective"
};

export const ReviewRoleSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || "group" in value) {
    return value;
  }
  const id = (value as { id?: unknown }).id;
  return {
    ...value,
    group: typeof id === "string" ? legacyRoleGroupById[id] ?? "custom" : "custom"
  };
}, z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  group: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  focusAreas: z.array(z.string().min(1)),
  defaultSelected: z.boolean(),
  source: z.enum(["global", "generated"]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
}));

export const AutomationRunRequestSchema = z.object({
  cwd: z.string().min(1),
  file: z.string().min(1),
  reviewers: z.array(reviewBatchReviewerSchema).min(1),
  roles: z.array(ReviewRoleSchema).optional(),
  claudeTemplateId: z.string().min(1),
  codexTemplateId: z.string().min(1),
  reviewStyle: reviewStyleSchema.default("full"),
  language: z.string().min(1).optional(),
  timeoutMs: timeoutSchema,
  maxOutputBytes: maxOutputBytesSchema,
  fullyAuto: z.boolean().default(true),
  maxIterations: maxIterationsSchema
});

export const TaskResultSchema = z.object({
  status: z.enum(["pending", "running", "ok", "error", "cancelled", "timeout"]),
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
