import type { ProviderConfig } from "@ccagent/core";
import { buildProviderFromForm } from "../guiLogic.js";

export interface ProviderFormProps {
  provider?: ProviderConfig;
  secretFingerprint?: string;
  onSave?(provider: ProviderConfig, apiKey?: string): void | Promise<void>;
  onTest?(provider: ProviderConfig, apiKey?: string): void | Promise<void>;
}

export function ProviderForm({ provider, secretFingerprint, onSave, onTest }: ProviderFormProps) {
  const current = provider ?? emptyProvider();

  return (
    <form
      className="panel provider-form"
      aria-label="Provider editor"
      onSubmit={(event) => {
        event.preventDefault();
        const { provider, apiKey } = buildProviderFromForm(new FormData(event.currentTarget), current);
        void onSave?.(provider, apiKey);
      }}
    >
      <div className="form-grid">
        <label>
          <span>Provider id</span>
          <input name="id" defaultValue={current.id} />
        </label>
        <label>
          <span>Display name</span>
          <input name="displayName" defaultValue={current.displayName} />
        </label>
        <label>
          <span>Mode</span>
          <select name="mode" defaultValue={current.mode}>
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="anthropic-compatible">Anthropic-compatible</option>
          </select>
        </label>
        <label>
          <span>Base URL</span>
          <input name="baseUrl" defaultValue={current.baseUrl} />
        </label>
        <label>
          <span>Auth header</span>
          <select name="authHeader" defaultValue={current.auth.header}>
            <option value="Authorization">Authorization</option>
            <option value="x-api-key">x-api-key</option>
          </select>
        </label>
        <label>
          <span>Auth scheme</span>
          <select name="authScheme" defaultValue={current.auth.scheme}>
            <option value="Bearer">Bearer</option>
            <option value="Raw">Raw</option>
          </select>
        </label>
        <label>
          <span>Default model</span>
          <input name="defaultModel" defaultValue={current.models.default} />
        </label>
        <label>
          <span>Review model</span>
          <input name="reviewModel" defaultValue={current.models.review ?? ""} />
        </label>
        <label className="check-row">
          <input
            name="streaming"
            type="checkbox"
            defaultChecked={current.capabilities.streaming}
          />
          <span>Streaming</span>
        </label>
        <label className="check-row">
          <input name="tools" type="checkbox" defaultChecked={current.capabilities.tools} />
          <span>Tools</span>
        </label>
        <label className="check-row">
          <input name="enabled" type="checkbox" defaultChecked={current.enabled} />
          <span>Enabled</span>
        </label>
        <label>
          <span>API key</span>
          <input name="apiKey" type="password" placeholder="Paste new key" />
          {secretFingerprint ? <small>Saved: {secretFingerprint}</small> : null}
        </label>
      </div>
      <div className="button-row">
        <button type="submit">Save</button>
        <button
          type="button"
          onClick={(event) => {
            const form = event.currentTarget.form;
            if (!form) {
              return;
            }
            const { provider, apiKey } = buildProviderFromForm(new FormData(form), current);
            void onTest?.(provider, apiKey);
          }}
        >
          Test
        </button>
      </div>
    </form>
  );
}

function emptyProvider(): ProviderConfig {
  const now = new Date(0).toISOString();
  return {
    id: "",
    displayName: "",
    mode: "openai-compatible",
    baseUrl: "",
    apiKeyRef: "",
    auth: {
      header: "Authorization",
      scheme: "Bearer"
    },
    models: {
      default: ""
    },
    capabilities: {
      streaming: true,
      tools: false,
      systemPrompt: true
    },
    enabled: true,
    createdAt: now,
    updatedAt: now
  };
}
