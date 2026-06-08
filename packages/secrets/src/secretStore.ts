export interface SecretStore {
  set(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string>;
  delete(ref: string): Promise<void>;
  has(ref: string): Promise<boolean>;
  fingerprint(ref: string): Promise<string>;
}

export function fingerprintSecret(value: string): string {
  if (value.length <= 8) {
    return "****";
  }

  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}
