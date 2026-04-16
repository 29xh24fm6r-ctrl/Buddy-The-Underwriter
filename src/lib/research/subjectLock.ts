import "server-only";

/**
 * Phase 80: Pre-Research Subject Lock
 *
 * Validates that the subject is sufficiently identified before allowing
 * BIE research to dispatch. Prevents garbage-in → garbage-out research
 * (e.g., yacht-charter memo on NAICS 999999).
 *
 * Required for full-underwrite research:
 *   - borrower legal name
 *   - industry OR NAICS (not 999999)
 *   - business description (or banker override)
 *   - geography (city/state OR override)
 *   - at least one of: website, DBA, banker summary
 */

export type SubjectLockResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

export type SubjectLockInput = {
  company_name: string | null | undefined;
  naics_code: string | null | undefined;
  naics_description: string | null | undefined;
  business_description?: string | null;
  city: string | null | undefined;
  state: string | null | undefined;
  geography: string | null | undefined;
  website?: string | null;
  dba?: string | null;
  banker_summary?: string | null;
  banker_override?: boolean;
};

const PLACEHOLDER_NAICS = "999999";
const MIN_NAME_LENGTH = 3;

export function validateSubjectLock(input: SubjectLockInput): SubjectLockResult {
  const reasons: string[] = [];

  // 1. Borrower legal name
  const name = (input.company_name ?? "").trim();
  if (name.length < MIN_NAME_LENGTH) {
    reasons.push("Borrower legal name is missing or too short");
  }

  // 2. Industry identification — need NAICS (non-placeholder) OR description
  const naics = (input.naics_code ?? "").trim();
  const naicsDesc = (input.naics_description ?? "").trim();
  const hasValidNaics = naics.length > 0 && naics !== PLACEHOLDER_NAICS;
  const hasNaicsDesc = naicsDesc.length > 5;

  if (!hasValidNaics && !hasNaicsDesc) {
    reasons.push("Industry not identified — NAICS is missing or placeholder (999999)");
  }

  // 3. Business description (or banker override)
  const bizDesc = (input.business_description ?? "").trim();
  if (bizDesc.length < 10 && !input.banker_override) {
    reasons.push("Business description is missing — required for meaningful research");
  }

  // 4. Geography
  const hasCity = (input.city ?? "").trim().length > 0;
  const hasState = (input.state ?? "").trim().length > 0;
  const hasGeo = (input.geography ?? "").trim().length > 0;
  if (!hasCity && !hasState && !hasGeo && !input.banker_override) {
    reasons.push("Geography is missing — city/state required for market research");
  }

  // 5. At least one identifying anchor: website, DBA, or banker summary
  const hasWebsite = (input.website ?? "").trim().length > 3;
  const hasDba = (input.dba ?? "").trim().length > 2;
  const hasBankerSummary = (input.banker_summary ?? "").trim().length > 10;
  if (!hasWebsite && !hasDba && !hasBankerSummary && !input.banker_override) {
    reasons.push("No identifying anchor — provide website, DBA, or banker summary");
  }

  // Banker override can satisfy missing business description, geography, and anchor
  // but NEVER satisfies missing name or industry — those are hard requirements
  if (reasons.length === 0 || input.banker_override) {
    const hardFailures = reasons.filter(
      (r) => r.includes("legal name") || r.includes("Industry not identified"),
    );
    if (hardFailures.length === 0) {
      return { ok: true };
    }
    return { ok: false, reasons: hardFailures };
  }

  return { ok: false, reasons };
}
