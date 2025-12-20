// src/lib/portal/token.ts
import crypto from "crypto";

export function newPortalToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function sha256Base64url(input: string): string {
  return crypto.createHash("sha256").update(input).digest("base64url");
}

export function isExpired(expiresAtIso: string): boolean {
  return new Date(expiresAtIso).getTime() <= Date.now();
}
