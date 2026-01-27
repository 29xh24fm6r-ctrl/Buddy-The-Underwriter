/**
 * Omega redaction utilities.
 *
 * Server-only. Read-only. Deny-by-default: fields not explicitly allowed are
 * stripped when emitting payloads toward Omega.
 *
 * No document bytes. No raw tax returns. No raw SSNs or EINs.
 */

import { createHash } from "node:crypto";
import { getRedactionProfile, type RedactionProfile } from "./mapping";

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/**
 * Mask an EIN to **-***NNNN format.
 * Accepts 9-digit string with or without dash. Returns masked form.
 * If input is already masked or invalid, returns it unchanged.
 */
export function maskEin(ein: string): string {
  const digits = ein.replace(/[^0-9]/g, "");
  if (digits.length !== 9) return ein; // already masked or invalid
  return `**-***${digits.slice(5)}`;
}

/**
 * SHA-256 hash of a string value, returned as base64url.
 */
export function hashId(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

// ---------------------------------------------------------------------------
// Payload redaction (deny-by-default)
// ---------------------------------------------------------------------------

/** Fields that are ALWAYS denied regardless of profile. */
const GLOBAL_DENY: ReadonlySet<string> = new Set([
  "ssn",
  "ssn_full",
  "ein_raw",
  "document_bytes",
  "raw_tax_return",
]);

/**
 * Redact a payload object according to a named redaction profile from the
 * canonical mapping.
 *
 * - Fields in the profile's `deny_fields` (and GLOBAL_DENY) are removed.
 * - Fields in `mask_fields` have maskEin applied (if string).
 * - Fields in `hash_fields` have hashId applied (if string).
 * - Operates recursively on nested objects.
 * - Arrays are mapped element-wise.
 *
 * Returns a new object; never mutates the input.
 */
export function redactPayload(
  profileName: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const profile = getRedactionProfile(profileName);
  if (!profile) {
    throw new Error(`Unknown redaction profile: ${profileName}`);
  }
  return applyRedaction(profile, payload);
}

// ---------------------------------------------------------------------------
// Internal recursive walker
// ---------------------------------------------------------------------------

function applyRedaction(
  profile: RedactionProfile,
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const denySet = new Set([...GLOBAL_DENY, ...profile.deny_fields]);
  const maskSet = new Set(profile.mask_fields);
  const hashSet = new Set(profile.hash_fields);

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Deny check (case-insensitive key match)
    if (denySet.has(key) || denySet.has(key.toLowerCase())) {
      continue;
    }

    if (value === null || value === undefined) {
      result[key] = value;
      continue;
    }

    // Mask check
    if (maskSet.has(key) && typeof value === "string") {
      result[key] = maskEin(value);
      continue;
    }

    // Hash check
    if (hashSet.has(key) && typeof value === "string") {
      result[key] = hashId(value);
      continue;
    }

    // Recurse into nested objects
    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? applyRedaction(profile, item as Record<string, unknown>)
          : item,
      );
      continue;
    }

    if (typeof value === "object") {
      result[key] = applyRedaction(
        profile,
        value as Record<string, unknown>,
      );
      continue;
    }

    result[key] = value;
  }

  return result;
}
