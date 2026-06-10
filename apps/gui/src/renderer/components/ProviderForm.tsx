import type { ProviderConfig } from "@ccagent/core";
import { buildProviderFromForm } from "../guiLogic.js";
import { createTranslator, type Translator } from "../i18n.js";

export interface ProviderFormProps {
  t?: Translator;
  provider?: ProviderConfig;
  secretFingerprint?: string;
  onSave?(provider: ProviderConfig, apiKey?: string): void | Promise<void>;
  onTest?(provider: ProviderConfig, apiKey?: string): void | Promise<void>;
}

export function ProviderForm({ t = createTranslator("en"), provider, secretFingerprint, onSave, onTest }: ProviderFormProps) {
  const current = provider ?? emptyProvider();

  return (
    <form
      className="panel provider-form"
      aria-label={t("providerEditor")}
      onSubmit={(event) => {
        event.preventDefault();
        const { provider, apiKey } = buildProviderFromForm(new FormData(event.currentTarget), current);
        void onSave?.(provider, apiKey);
      }}
    >
      <div className="form-grid">
        <label>
          <span>{t("providerId")}</span>
          <input name="id" defaultValue={current.id} />
        </label>
        <label>
          <span>{t("displayName")}</span>
          <input name="displayName" defaultValue={current.displayName} />
        </label>
        <label>
          <span>{t("mode")}</span>
          <select name="mode" defaultValue={current.mode}>
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="anthropic-compatible">Anthropic-compatible</option>
          </select>
        </label>
        <label>
          <span>{t("baseUrl")}</span>
          <input name="baseUrl" defaultValue={current.baseUrl} />
        </label>
        <label>
          <span>{t("authHeader")}</span>
          <select name="authHeader" defaultValue={current.auth.header}>
            <option value="Authorization">Authorization</option>
            <option value="x-api-key">x-api-key</option>
          </select>
        </label>
        <label>
          <span>{t("authScheme")}</span>
          <select name="authScheme" defaultValue={current.auth.scheme}>
            <option value="Bearer">Bearer</option>
            <option value="Raw">Raw</option>
          </select>
        </label>
        <label>
          <span>{t("defaultModel")}</span>
          <input name="defaultModel" defaultValue={current.models.default} />
        </label>
        <label>
          <span>{t("reviewModel")}</span>
          <input name="reviewModel" defaultValue={current.models.review ?? ""} />
        </label>
        <label className="check-row">
          <input
            name="streaming"
            type="checkbox"
            defaultChecked={current.capabilities.streaming}
          />
          <span>{t("streaming")}</span>
        </label>
        <label className="check-row">
          <input name="tools" type="checkbox" defaultChecked={current.capabilities.tools} />
          <span>{t("tools")}</span>
        </label>
        <label className="check-row">
          <input name="enabled" type="checkbox" defaultChecked={current.enabled} />
          <span>{t("enabled")}</span>
        </label>
        <label>
          <span>{t("apiKey")}</span>
          <input name="apiKey" type="password" placeholder={t("pasteNewKey")} />
          {secretFingerprint ? <small>{t("savedSecret", { fingerprint: secretFingerprint })}</small> : null}
        </label>
      </div>
      <div className="button-row">
        <button type="submit">{t("save")}</button>
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
          {t("test")}
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
