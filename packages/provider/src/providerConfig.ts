import type { ProviderConfig } from "@ccagent/core";

export interface BuiltInProviders {
  deepseek: ProviderConfig;
  glm: ProviderConfig;
}

export function createBuiltInProviders(now = new Date().toISOString()): BuiltInProviders {
  return {
    deepseek: {
      id: "deepseek",
      displayName: "DeepSeek",
      mode: "openai-compatible",
      baseUrl: "https://api.deepseek.com",
      apiKeyRef: "providers/deepseek/api-key",
      auth: { header: "Authorization", scheme: "Bearer" },
      models: { default: "deepseek-v4-flash", review: "deepseek-v4-flash" },
      capabilities: {
        streaming: true,
        tools: false,
        systemPrompt: true
      },
      enabled: true,
      createdAt: now,
      updatedAt: now
    },
    glm: {
      id: "glm",
      displayName: "Zhipu GLM",
      mode: "openai-compatible",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeyRef: "providers/glm/api-key",
      auth: { header: "Authorization", scheme: "Bearer" },
      models: { default: "glm-5.1", review: "glm-5.1" },
      capabilities: {
        streaming: true,
        tools: false,
        systemPrompt: true
      },
      enabled: true,
      createdAt: now,
      updatedAt: now
    }
  };
}
