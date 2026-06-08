import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CCAgentError, ErrorCodes } from "@ccagent/core";
import type { SecretStore } from "./secretStore.js";
import { fingerprintSecret } from "./secretStore.js";

interface SecretFile {
  version: 1;
  secrets: Record<string, EncryptedSecret>;
}

interface EncryptedSecret {
  iv: string;
  tag: string;
  value: string;
}

export class DpapiStore implements SecretStore {
  constructor(public readonly filePath = defaultSecretFilePath()) {}

  async set(ref: string, value: string): Promise<void> {
    const file = this.readFile();
    file.secrets[ref] = encrypt(this.filePath, value);
    this.writeFile(file);
  }

  async get(ref: string): Promise<string> {
    return this.getSync(ref);
  }

  getSync(ref: string): string {
    const secret = this.readFile().secrets[ref];
    if (!secret) {
      throw new CCAgentError(ErrorCodes.SecretMissing, `secret missing: ${ref}`);
    }
    return decrypt(this.filePath, secret);
  }

  async delete(ref: string): Promise<void> {
    const file = this.readFile();
    delete file.secrets[ref];
    this.writeFile(file);
  }

  async has(ref: string): Promise<boolean> {
    return this.readFile().secrets[ref] !== undefined;
  }

  async fingerprint(ref: string): Promise<string> {
    return fingerprintSecret(await this.get(ref));
  }

  async readRawForTests(): Promise<string> {
    return existsSync(this.filePath) ? readFileSync(this.filePath, "utf8") : "";
  }

  private readFile(): SecretFile {
    if (!existsSync(this.filePath)) {
      return { version: 1, secrets: {} };
    }
    return JSON.parse(readFileSync(this.filePath, "utf8")) as SecretFile;
  }

  private writeFile(file: SecretFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
  }
}

function encrypt(filePath: string, value: string): EncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFor(filePath), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    value: encrypted.toString("base64")
  };
}

function decrypt(filePath: string, secret: EncryptedSecret): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyFor(filePath),
    Buffer.from(secret.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.value, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function keyFor(filePath: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`${process.env.USERDOMAIN ?? ""}\0${process.env.USERNAME ?? ""}\0${filePath}`)
    .digest();
}

function defaultSecretFilePath(): string {
  const appData = process.env.APPDATA ?? process.cwd();
  return `${appData}/CCAgent/secrets.json`;
}
