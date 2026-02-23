/**
 * PII-safe error summarizer for intake processing.
 *
 * Pure module — no server-only, no DB. Safe for CI guards and client import.
 * Strips SSNs, emails, long digit sequences, and file paths before display.
 */

// ── PII patterns ────────────────────────────────────────────────────────

const PII_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/g,                                 // SSN
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/gi,     // email
  /\b\d{10,}\b/g,                                            // long digit sequences (account numbers)
  /\/(?:home|Users|tmp|var)\/[^\s;]+/g,                      // file paths
];

export const MAX_ERROR_LEN = 300;
export const MAX_ERRORS = 5;

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Scrub PII patterns from a raw error string.
 * Replaces SSNs, emails, long digit sequences, and file paths with [REDACTED].
 */
export function scrubPii(raw: string): string {
  let out = raw;
  for (const pat of PII_PATTERNS) {
    // Reset lastIndex for global regexes reused across calls
    pat.lastIndex = 0;
    out = out.replace(pat, "[REDACTED]");
  }
  return out;
}

/**
 * Sanitize and summarize processing errors for safe display.
 * - Strips PII patterns
 * - Truncates individual errors to MAX_ERROR_LEN
 * - Joins up to MAX_ERRORS with "; "
 * - Final output capped at 500 chars
 */
export function summarizeProcessingErrors(errors: string[]): string {
  return errors
    .slice(0, MAX_ERRORS)
    .map((e) => scrubPii(e).slice(0, MAX_ERROR_LEN))
    .join("; ")
    .slice(0, 500);
}
