import { CCAgentError, ErrorCodes } from "@ccagent/core";
import { fingerprintSecret, type SecretStore } from "./secretStore.js";

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async set(ref: string, value: string): Promise<void> {
    this.values.set(ref, value);
  }

  async get(ref: string): Promise<string> {
    const value = this.values.get(ref);
    if (value === undefined) {
      throw new CCAgentError(ErrorCodes.SecretMissing, `secret missing: ${ref}`);
    }
    return value;
  }

  async delete(ref: string): Promise<void> {
    this.values.delete(ref);
  }

  async has(ref: string): Promise<boolean> {
    return this.values.has(ref);
  }

  async fingerprint(ref: string): Promise<string> {
    return fingerprintSecret(await this.get(ref));
  }
}
