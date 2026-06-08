export class CCAgentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly detail?: string
  ) {
    super(message);
    this.name = "CCAgentError";
  }
}

export const ErrorCodes = {
  PathDenied: "CCAGENT_PATH_DENIED",
  ProviderMissing: "CCAGENT_PROVIDER_MISSING",
  ProviderDisabled: "CCAGENT_PROVIDER_DISABLED",
  SecretMissing: "CCAGENT_SECRET_MISSING",
  ClaudeNotFound: "CCAGENT_CLAUDE_NOT_FOUND",
  ClaudeMissing: "CCAGENT_CLAUDE_NOT_FOUND",
  ClaudeUnsupported: "CCAGENT_CLAUDE_UNSUPPORTED",
  TaskMissing: "CCAGENT_TASK_MISSING",
  TaskLimit: "CCAGENT_TASK_LIMIT",
  Timeout: "CCAGENT_TIMEOUT",
  Cancelled: "CCAGENT_CANCELLED",
  ProxyUnsupported: "CCAGENT_PROXY_UNSUPPORTED",
  ProxyPortUnavailable: "CCAGENT_PROXY_PORT_UNAVAILABLE",
  ParseError: "CCAGENT_PARSE_ERROR",
  DaemonUnavailable: "CCAGENT_DAEMON_UNAVAILABLE",
  DaemonAuthUnavailable: "CCAGENT_DAEMON_AUTH_UNAVAILABLE",
  DaemonRecovered: "CCAGENT_DAEMON_RECOVERED"
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
