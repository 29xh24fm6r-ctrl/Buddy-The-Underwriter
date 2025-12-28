/**
 * Stable hash function for decision snapshots
 * Creates deterministic hash from decision inputs + outputs
 */
import crypto from "crypto";

export function stableHash(obj: any): string {
  // Sort keys for deterministic stringification
  const sorted = JSON.stringify(obj, Object.keys(obj).sort());
  return crypto.createHash("sha256").update(sorted).digest("hex");
}
