import "server-only";

/**
 * Layer 3 — deterministic PII scanner backstop. Runs on the Gemini-
 * generated anonymized narrative before it's accepted as the final
 * KFS narrative. If any hit fires, the narrative is discarded and
 * a deterministic templated narrative replaces it.
 *
 * This is a BACKSTOP. The security boundary is Layer 1 (redactor).
 */

export type PiiScanContext = {
  borrowerFirstName?: string | null;
  borrowerLastName?: string | null;
  businessLegalName?: string | null;
  businessDbaName?: string | null;
  city?: string | null;
  zip?: string | null;
};

export type PiiScanResult = {
  hasPII: boolean;
  hits: string[];
};

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_REGEX =
  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const ZIP_REGEX = /\b\d{5}(?:-\d{4})?\b/;
const STREET_SUFFIX_REGEX =
  /\b\d+\s+\w+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Plaza|Plz|Circle|Cir)\b/i;

export function scanForPII(
  text: string,
  ctx: PiiScanContext,
): PiiScanResult {
  const hits: string[] = [];

  if (EMAIL_REGEX.test(text)) hits.push("email pattern");
  if (PHONE_REGEX.test(text)) hits.push("phone pattern");
  if (ZIP_REGEX.test(text)) hits.push("ZIP pattern");
  if (STREET_SUFFIX_REGEX.test(text)) hits.push("street address pattern");

  const knownBad: Array<[string | null | undefined, string]> = [
    [ctx.borrowerFirstName, "borrower first name"],
    [ctx.borrowerLastName, "borrower last name"],
    [ctx.businessLegalName, "business legal name"],
    [ctx.businessDbaName, "business DBA"],
    [ctx.city, "city name"],
    [ctx.zip, "ZIP"],
  ];

  for (const [token, label] of knownBad) {
    if (!token || token.trim().length < 2) continue;
    const pattern = new RegExp(`\\b${escapeRegex(token)}\\b`, "i");
    if (pattern.test(text)) hits.push(label);
  }

  return { hasPII: hits.length > 0, hits };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
