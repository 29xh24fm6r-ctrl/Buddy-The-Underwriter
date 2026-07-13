import "server-only";
import * as crypto from "node:crypto";

/**
 * AES-256-GCM encrypt/decrypt for Plaid access tokens at rest
 * (borrower_bank_connections.plaid_access_token_encrypted).
 *
 * PLAID_ACCESS_TOKEN_ENCRYPTION_KEY is a 32-byte key, base64-encoded (see
 * .env.example). v1 key management is an env var; v2 (KMS/Supabase Vault)
 * is deferred per spec risk register #5.
 */

function getKey(): Buffer {
  const raw = process.env.PLAID_ACCESS_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("Missing PLAID_ACCESS_TOKEN_ENCRYPTION_KEY — required to store/read Plaid access tokens.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `PLAID_ACCESS_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). Generate with: openssl rand -base64 32`,
    );
  }
  return key;
}

export function encryptPlaidAccessToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12); // GCM standard IV length
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `gcm:${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptPlaidAccessToken(encoded: string): string {
  const key = getKey();
  const parts = encoded.split(":");
  if (parts.length !== 4 || parts[0] !== "gcm") {
    throw new Error("Malformed encrypted Plaid access token.");
  }
  const [, ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
