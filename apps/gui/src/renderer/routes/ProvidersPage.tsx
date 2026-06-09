import type { ProviderConfig } from "@ccagent/core";
import { useMemo, useState } from "react";
import { ProviderForm } from "../components/ProviderForm.js";

export interface ProvidersPageProps {
  providers: ProviderConfig[];
  selectedProviderId?: string;
  secretFingerprints?: Record<string, string>;
  onSelectProvider?(providerId: string): void;
  onSaveProvider?(provider: ProviderConfig, apiKey?: string): void | Promise<void>;
  onDeleteProvider?(providerId: string): void | Promise<void>;
  onTestProvider?(provider: ProviderConfig, apiKey?: string): void | Promise<void>;
}

export function ProvidersPage({
  providers,
  selectedProviderId,
  secretFingerprints = {},
  onSelectProvider,
  onSaveProvider,
  onDeleteProvider,
  onTestProvider
}: ProvidersPageProps) {
  const [isCreating, setIsCreating] = useState(false);
  const selected = useMemo(
    () => (isCreating ? undefined : providers.find((provider) => provider.id === selectedProviderId) ?? providers[0]),
    [isCreating, providers, selectedProviderId]
  );

  return (
    <section className="page-section" id="providers">
      <header className="section-header">
        <h2>Providers</h2>
        <button type="button" onClick={() => setIsCreating(true)}>
          New provider
        </button>
      </header>
      <div className="provider-layout">
        <aside className="provider-list">
          {providers.map((provider) => (
            <button
              type="button"
              key={provider.id}
              className={!isCreating && provider.id === selected?.id ? "selected" : undefined}
              onClick={() => {
                setIsCreating(false);
                onSelectProvider?.(provider.id);
              }}
            >
              <strong>{provider.displayName}</strong>
              <span>{provider.mode}</span>
            </button>
          ))}
        </aside>
        <div className="editor-stack">
          <ProviderForm
            key={selected?.id ?? "new-provider"}
            provider={selected}
            secretFingerprint={selected ? secretFingerprints[selected.id] : undefined}
            onSave={async (provider, apiKey) => {
              await onSaveProvider?.(provider, apiKey);
              setIsCreating(false);
            }}
            onTest={onTestProvider}
          />
          {selected ? (
            <div className="button-row danger-row">
              <button type="button" onClick={() => void onDeleteProvider?.(selected.id)}>
                Delete provider
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
