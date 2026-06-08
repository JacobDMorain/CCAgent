import { CCAgentError } from "@ccagent/core";
import type { SecretStore } from "./secretStore.js";

export class WindowsCredentialStore implements SecretStore {
  async set(): Promise<void> {
    throw unavailable();
  }

  async get(): Promise<string> {
    throw unavailable();
  }

  async delete(): Promise<void> {
    throw unavailable();
  }

  async has(): Promise<boolean> {
    return false;
  }

  async fingerprint(): Promise<string> {
    throw unavailable();
  }
}

function unavailable(): CCAgentError {
  return new CCAgentError(
    "CCAGENT_SECRET_BACKEND_UNAVAILABLE",
    "Windows Credential Manager backend is not implemented in this build"
  );
}
