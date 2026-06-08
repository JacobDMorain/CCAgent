import type { ProviderConfig } from "@ccagent/core";
import { ProviderForm } from "../components/ProviderForm.js";

export interface ProvidersPageProps {
  providers: ProviderConfig[];
  selectedProviderId?: string;
  secretFingerprints?: Record<string, string>;
  onSelectProvider?(providerId: string): void;
  onSaveProvider?(provider: ProviderConfig, apiKey?: string): void | Promise<void>;
  onTestProvider?(provider: string, model?: string): void | Promise<void>;
}

export function ProvidersPage({
  providers,
  selectedProviderId,
  secretFingerprints = {},
  onSelectProvider,
  onSaveProvider,
  onTestProvider
}: ProvidersPageProps) {
  const selected = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];

  return (
    <section className="page-section" id="providers">
      <header>
        <h2>Providers</h2>
      </header>
      <div className="provider-layout">
        <aside className="provider-list">
          {providers.map((provider) => (
            <button
              type="button"
              key={provider.id}
              className={provider.id === selected?.id ? "selected" : undefined}
              onClick={() => onSelectProvider?.(provider.id)}
            >
              <strong>{provider.displayName}</strong>
              <span>{provider.mode}</span>
            </button>
          ))}
        </aside>
        <ProviderForm
          provider={selected}
          secretFingerprint={selected ? secretFingerprints[selected.id] : undefined}
          onSave={onSaveProvider}
          onTest={onTestProvider}
        />
      </div>
    </section>
  );
}
