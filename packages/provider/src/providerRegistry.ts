import { CCAgentError, ErrorCodes, type ProviderConfig } from "@ccagent/core";

export interface ProviderStore {
  delete(id: string): Promise<void>;
  get(id: string): Promise<ProviderConfig | undefined>;
  list(): Promise<ProviderConfig[]>;
  save(provider: ProviderConfig): Promise<void>;
}

export class InMemoryProviderStore implements ProviderStore {
  private readonly providers = new Map<string, ProviderConfig>();

  async delete(id: string): Promise<void> {
    this.providers.delete(id);
  }

  async get(id: string): Promise<ProviderConfig | undefined> {
    const provider = this.providers.get(id);
    return provider ? cloneProvider(provider) : undefined;
  }

  async list(): Promise<ProviderConfig[]> {
    return [...this.providers.values()].map(cloneProvider);
  }

  async save(provider: ProviderConfig): Promise<void> {
    this.providers.set(provider.id, cloneProvider(provider));
  }
}

export class ProviderRegistry {
  constructor(private readonly store: ProviderStore) {}

  async deleteProvider(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async getEnabledProvider(id: string): Promise<ProviderConfig> {
    const provider = await this.store.get(id);
    if (!provider) {
      throw new CCAgentError(ErrorCodes.ProviderMissing, `provider not found: ${id}`);
    }
    if (!provider.enabled) {
      throw new CCAgentError(ErrorCodes.ProviderDisabled, `provider is disabled: ${id}`);
    }
    return provider;
  }

  async listProviders(): Promise<ProviderConfig[]> {
    return this.store.list();
  }

  async resolveModel(id: string, explicitModel?: string): Promise<string> {
    if (explicitModel) {
      return explicitModel;
    }

    const provider = await this.getEnabledProvider(id);
    return provider.models.review ?? provider.models.default;
  }

  async saveProvider(provider: ProviderConfig): Promise<void> {
    await this.store.save(provider);
  }
}

function cloneProvider(provider: ProviderConfig): ProviderConfig {
  return structuredClone(provider);
}
