import type { AutomationRunRecord, ProviderConfig } from "@ccagent/core";

export function buildProviderFromForm(
  form: FormData,
  current: ProviderConfig,
  now = new Date().toISOString()
): { provider: ProviderConfig; apiKey?: string } {
  const id = stringField(form, "id");
  const authHeader = stringField(form, "authHeader") as ProviderConfig["auth"]["header"];
  return {
    provider: {
      id,
      displayName: stringField(form, "displayName"),
      mode: stringField(form, "mode") as ProviderConfig["mode"],
      baseUrl: stringField(form, "baseUrl"),
      apiKeyRef: current.apiKeyRef || `ccagent/providers/${id}/api-key`,
      auth: {
        header: authHeader,
        scheme: authHeader === "x-api-key"
          ? "Raw"
          : stringField(form, "authScheme") as ProviderConfig["auth"]["scheme"]
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

export function formatRunDecisionSummary(run: AutomationRunRecord, runOutput: string): string {
  if (run.status === "failed") {
    const reason = parseErrorMessage(run.errorJson);
    return [
      `Codex did not produce a review decision for ${run.file}.`,
      reason ? `Reason: ${reason.replace(/^CCAGENT_[A-Z_]+:\s*/, "")}` : undefined
    ].filter(Boolean).join("\n");
  }

  const finalReport = extractOutputSection(runOutput, "final-report.md");
  const decisionSummary = extractOutputSection(runOutput, "codex-decision-summary.md");
  const latestIterationSummary = extractLastOutputSection(runOutput, "/codex-decision-summary.md");
  const codexOutput = finalReport || decisionSummary || latestIterationSummary || extractOutputSection(runOutput, "codex-output.md");
  if (codexOutput) {
    return [
      `Codex review decision for ${run.file}:`,
      "",
      codexOutput
    ].join("\n");
  }

  if (run.status === "codex_editing" || run.status === "verifying") {
    return `Codex is still reviewing provider feedback for ${run.file}.`;
  }

  if (run.status === "reviewing" || run.status === "merging" || run.status === "queued") {
    return `Provider review is still running for ${run.file}. Codex has not produced a review decision yet.`;
  }

  return `No Codex review decision is available for ${run.file}.`;
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

function extractOutputSection(output: string, label: string): string {
  const marker = `# ${label}`;
  const start = output.indexOf(marker);
  if (start === -1) {
    return "";
  }

  const contentStart = start + marker.length;
  const nextSection = output.indexOf("\n# ", contentStart);
  const rawSection = nextSection === -1
    ? output.slice(contentStart)
    : output.slice(contentStart, nextSection);
  return rawSection.trim();
}

function extractLastOutputSection(output: string, labelSuffix: string): string {
  const matches = [...output.matchAll(/^# (.+)$/gm)]
    .filter((match) => match[1].endsWith(labelSuffix));
  const last = matches.at(-1);
  if (!last || last.index === undefined) {
    return "";
  }

  const contentStart = last.index + last[0].length;
  const nextSection = output.indexOf("\n# ", contentStart);
  const rawSection = nextSection === -1
    ? output.slice(contentStart)
    : output.slice(contentStart, nextSection);
  return rawSection.trim();
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
