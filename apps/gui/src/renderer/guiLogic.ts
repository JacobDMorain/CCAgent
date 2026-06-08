import type { ProviderConfig } from "@ccagent/core";

export function buildProviderFromForm(
  form: FormData,
  current: ProviderConfig,
  now = new Date().toISOString()
): { provider: ProviderConfig; apiKey?: string } {
  const id = stringField(form, "id");
  return {
    provider: {
      id,
      displayName: stringField(form, "displayName"),
      mode: stringField(form, "mode") as ProviderConfig["mode"],
      baseUrl: stringField(form, "baseUrl"),
      apiKeyRef: current.apiKeyRef || `ccagent/providers/${id}/api-key`,
      auth: {
        header: stringField(form, "authHeader") as ProviderConfig["auth"]["header"],
        scheme: stringField(form, "authScheme") as ProviderConfig["auth"]["scheme"]
      },
      models: {
        default: stringField(form, "defaultModel"),
        review: optionalStringField(form, "reviewModel")
      },
      capabilities: {
        streaming: form.has("streaming"),
        tools: form.has("tools"),
        systemPrompt: true
      },
      enabled: form.has("enabled"),
      createdAt: current.createdAt || now,
      updatedAt: now
    },
    apiKey: optionalStringField(form, "apiKey")
  };
}

export function upsertProvider(providers: ProviderConfig[], provider: ProviderConfig): ProviderConfig[] {
  const existing = providers.findIndex((item) => item.id === provider.id);
  if (existing === -1) {
    return [...providers, provider];
  }

  return providers.map((item) => (item.id === provider.id ? provider : item));
}

export function formatOutput(output: unknown): string {
  if (typeof output === "object" && output !== null && "content" in output) {
    const content = (output as { content?: unknown }).content;
    return typeof content === "string" ? content : JSON.stringify(output, null, 2);
  }

  return typeof output === "string" ? output : JSON.stringify(output, null, 2);
}

export function parseErrorMessage(errorJson?: string): string {
  if (!errorJson) {
    return "";
  }

  try {
    const parsed = JSON.parse(errorJson) as { code?: string; message?: string };
    return [parsed.code, parsed.message].filter(Boolean).join(": ");
  } catch {
    return errorJson;
  }
}

export function toRuntimeError(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error && "code" in error ? String(error.code) : "CCAGENT_GUI_ERROR",
    message: error instanceof Error ? error.message : String(error)
  };
}

function stringField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function optionalStringField(form: FormData, name: string): string | undefined {
  const value = stringField(form, name);
  return value || undefined;
}
