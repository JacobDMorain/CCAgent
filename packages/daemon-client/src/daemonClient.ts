import { CCAgentError, ErrorCodes } from "@ccagent/core";

export interface DaemonClientOptions {
  baseUrl: string;
  token: string;
}

export class DaemonClient {
  private token: string;

  constructor(private readonly options: DaemonClientOptions) {
    this.token = options.token;
  }

  async get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    return this.request("POST", path, body);
  }

  async delete(path: string): Promise<unknown> {
    return this.request("DELETE", path);
  }

  async rotateToken(): Promise<string> {
    const response = (await this.post("/auth/rotate-token")) as { token: string };
    this.token = response.token;
    return this.token;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const json = await response.json().catch(() => undefined);
    if (!response.ok) {
      const error = json?.error;
      throw new CCAgentError(
        error?.code ?? ErrorCodes.DaemonUnavailable,
        error?.message ?? `daemon request failed with ${response.status}`,
        error?.detail
      );
    }

    return json;
  }
}
