import crypto from "crypto";

export function makePortalToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
