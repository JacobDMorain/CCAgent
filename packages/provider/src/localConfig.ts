export const localOperatorConfigKeys = new Set([
  "GLM_API_KEY",
  "DEEPSEEK_API_KEY",
  "GLM_BASE_URL",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_ANTHROPIC_BASE_URL",
  "CCAGENT_DAEMON_TOKEN",
  "CCAGENT_DAEMON_URL",
  "CCAGENT_ALLOWED_ROOTS",
  "CCAGENT_EXTERNAL_PROVIDER_CONSENT"
]);

export function parseLocalOperatorConfig(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !localOperatorConfigKeys.has(match[1])) {
      continue;
    }

    const value = stripOptionalQuotes(match[2].trim());
    if (value) {
      env[match[1]] = value;
    }
  }
  return env;
}

export interface ExternalProviderConsent {
  provider: string;
  root: string;
}

export function parseDelimitedLocalConfigValue(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[;,]/)
    .map((entry) => stripOptionalQuotes(entry.trim()))
    .filter(Boolean);
}

export function parseExternalProviderConsent(value: string | undefined): ExternalProviderConsent[] {
  return parseDelimitedLocalConfigValue(value).flatMap((entry) => {
    const index = entry.indexOf(":");
    if (index <= 0 || index === entry.length - 1) {
      return [];
    }
    const provider = entry.slice(0, index).trim();
    const root = entry.slice(index + 1).trim();
    return provider && root ? [{ provider, root }] : [];
  });
}

function stripOptionalQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
