import crypto from "crypto";

/**
 * Allowlist of fields that may leave Buddy in a Pulse event payload.
 * Everything else is dropped. This is the PII firewall.
 */
const ALLOWED_KEYS = new Set([
  "deal_id",
  "bank_id",
  "event_key",
  "document_id",
  "artifact_id",
  "source_id",
  "checklist_key",
  "document_type",
  "doc_year",
  "doc_years",
  "confidence",
  "match_confidence",
  "match_source",
  "status",
  "ui_state",
  "duration_ms",
  "error_code",
  "code",
  "stage",
  "reason",
  "ocr_triggered",
  "matched_keys",
  "stamped",
  "canonical_type",
  "previous_stage",
  "manual_checklist_key",
]);

/**
 * Patterns that indicate PII content.
 * If a string value matches any of these, it must be masked.
 */
const PII_PATTERNS: RegExp[] = [
  // SSN (xxx-xx-xxxx or 9 digits)
  /\b\d{3}-?\d{2}-?\d{4}\b/,
  // Email
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  // Phone (US-style)
  /\b\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/,
  // DOB-like dates (MM/DD/YYYY or YYYY-MM-DD with age-plausible years)
  /\b(?:0[1-9]|1[0-2])[/-](?:0[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b/,
];

/**
 * Hash a filename for safe logging: preserves extension, replaces name with short hash.
 * "John_Smith_2024_tax_return.pdf" → "a3f8c1.pdf"
 */
function hashFilename(filename: string): string {
  const dotIdx = filename.lastIndexOf(".");
  const ext = dotIdx >= 0 ? filename.slice(dotIdx) : "";
  const hash = crypto.createHash("sha256").update(filename).digest("hex").slice(0, 6);
  return `<${hash}${ext}>`;
}

/**
 * Returns true if a string value looks like it contains PII.
 */
function containsPii(val: string): boolean {
  return PII_PATTERNS.some((re) => re.test(val));
}

/**
 * Redact a ledger payload for safe forwarding to Pulse.
 *
 * - Only allowlisted keys survive.
 * - String values that match PII patterns are masked.
 * - Filenames are hashed.
 * - OCR text, raw document text, and large blobs are dropped entirely.
 * - Nested objects/arrays are recursively filtered.
 */
export function redactLedgerPayload(input: unknown): unknown {
  if (input === null || input === undefined) return null;
  if (typeof input === "number" || typeof input === "boolean") return input;

  if (typeof input === "string") {
    // Drop long strings (likely OCR/document text)
    if (input.length > 500) return "<redacted:long_string>";
    if (containsPii(input)) return "<redacted:pii>";
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactLedgerPayload(item));
  }

  if (typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      // Always drop known PII / text fields regardless of allowlist
      if (isBlockedKey(key)) continue;

      // Filename fields: hash instead of dropping
      if (isFilenameKey(key) && typeof value === "string") {
        result[key] = hashFilename(value);
        continue;
      }

      // Only allowlisted keys pass through at top level
      if (ALLOWED_KEYS.has(key)) {
        result[key] = redactLedgerPayload(value);
        continue;
      }

      // Nested objects get recursive filtering (e.g., meta.attempted.canonicalType)
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const nested = redactLedgerPayload(value);
        if (nested !== null && typeof nested === "object" && Object.keys(nested as object).length > 0) {
          result[key] = nested;
        }
        continue;
      }

      // Non-allowlisted scalar → drop
    }
    return result;
  }

  return null;
}

/**
 * Keys that must always be dropped (PII, raw text, blobs).
 */
function isBlockedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes("ocr_text") ||
    lower.includes("extracted_text") ||
    lower.includes("raw_text") ||
    lower.includes("document_text") ||
    lower === "text" ||
    lower === "ssn" ||
    lower === "dob" ||
    lower === "date_of_birth" ||
    lower === "social_security" ||
    lower === "address" ||
    lower === "street" ||
    lower === "email" ||
    lower === "phone" ||
    lower === "phone_number" ||
    lower === "account_number" ||
    lower === "bank_account" ||
    lower === "routing_number" ||
    lower === "raw_json" ||
    lower === "extraction_json" ||
    lower === "ai_extracted_json" ||
    lower === "stack"
  );
}

/**
 * Keys that represent filenames — hash instead of drop.
 */
function isFilenameKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower === "filename" ||
    lower === "original_filename" ||
    lower === "file_name" ||
    lower === "storage_path"
  );
}
