import type { ProviderConfig } from "@ccagent/core";

export function resolveProviderModel(provider: ProviderConfig, explicitModel?: string): string {
  return explicitModel ?? provider.models.review ?? provider.models.default;
}
