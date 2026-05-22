/**
 * Credit Memo Source-of-Truth Priority Contract
 *
 * Defines the canonical precedence order for each memo section.
 * buildCanonicalCreditMemo MUST respect this order.
 * Tests assert that canonical sources beat legacy overrides.
 *
 * This file is pure — no DB, no server-only imports. Safe for CI guards.
 */

// ─── Borrower Story ────────────────────────────────────────────────────────
// 1. deal_borrower_story (canonical narrative table)
// 2. fresh canonical_memo_narratives with matching input_hash
// 3. deal_memo_overrides legacy fallback (quarantined)
// 4. qualitative facts from deal_financial_facts
// 5. Pending / blocker
export const BORROWER_STORY_PRIORITY = [
  "deal_borrower_story",
  "canonical_memo_narratives:hash_matched",
  "deal_memo_overrides:legacy_fallback",
  "deal_financial_facts:qualitative",
  "pending",
] as const;

// ─── Management ────────────────────────────────────────────────────────────
// 1. deal_management_profiles (per-person bios)
// 2. ownership_entities (ownership/guarantor identity ONLY — not bios)
// 3. principal_bio_* from deal_memo_overrides (legacy fallback only)
// 4. qualitative MANAGEMENT facts
// 5. Pending / blocker
export const MANAGEMENT_PRIORITY = [
  "deal_management_profiles",
  "ownership_entities:identity_only",
  "deal_memo_overrides:principal_bio:legacy_fallback",
  "deal_financial_facts:management",
  "pending",
] as const;

// ─── Collateral (AR LOC) ───────────────────────────────────────────────────
// 1. ar_aging_reports + borrowing_base_calculations
// 2. deal_collateral_items
// 3. canonical AR facts from deal_financial_facts
// 4. deal_memo_overrides.collateral_description (only if no AR data)
// 5. Pending / blocker
export const COLLATERAL_AR_LOC_PRIORITY = [
  "ar_aging_reports+borrowing_base_calculations",
  "deal_collateral_items",
  "deal_financial_facts:ar_canonical",
  "deal_memo_overrides:collateral_description:legacy_fallback",
  "pending",
] as const;

// ─── Narratives ────────────────────────────────────────────────────────────
// 1. Deterministic canonical memo facts (always computed)
// 2. canonical_memo_narratives ONLY if input_hash matches
// 3. Stale narratives SKIPPED (never overlaid)
// 4. Manual banker notes remain separate (banker_context field)
export const NARRATIVE_PRIORITY = [
  "deterministic_canonical_facts",
  "canonical_memo_narratives:hash_matched",
  "stale_narratives:skipped",
] as const;

// ─── Spreads (committee-facing) ────────────────────────────────────────────
// 1. Canonical memo tables for body (debt coverage, income statement, etc.)
// 2. SpreadsAppendix for meaningful data spreads only
// 3. CLASSIC_PDF / STANDARD excluded from committee-facing lists
// 4. Placeholder GLOBAL_CASH_FLOW excluded until real rows exist
export const SPREADS_PRIORITY = [
  "canonical_memo_tables",
  "deal_spreads:meaningful_only",
  "classic_pdf:excluded",
  "standard:excluded",
  "gcf_placeholder:excluded",
] as const;

// ─── Banker Notes ──────────────────────────────────────────────────────────
// 1. deal_borrower_story.banker_notes (live memo)
// 2. submit payload bankerNotes (frozen)
// 3. snapshot banker_submission.notes (frozen display)
export const BANKER_NOTES_PRIORITY = [
  "deal_borrower_story:banker_notes",
  "submit_payload:bankerNotes",
  "snapshot:banker_submission:notes",
] as const;

// ─── Legacy Fallback Detection ─────────────────────────────────────────────

export type LegacyFallbackField =
  | "business_description"
  | "revenue_mix"
  | "seasonality"
  | "collateral_description"
  | "competitive_advantages"
  | "vision"
  | "principal_bio";

/**
 * Returns the canonical value if present, or the legacy fallback with tracking.
 * Use this for all reads from deal_memo_overrides in buildCanonicalCreditMemo.
 */
export function getLegacyMemoOverrideFallback(
  canonicalValue: string | null | undefined,
  legacyOverrideValue: string | null | undefined,
  fieldName: LegacyFallbackField,
  diagnostics: { legacy_fallback_fields: string[] },
): string | null {
  if (canonicalValue && canonicalValue.trim().length > 0 && !canonicalValue.startsWith("Pending")) {
    return canonicalValue;
  }
  if (legacyOverrideValue && legacyOverrideValue.trim().length > 0) {
    diagnostics.legacy_fallback_fields.push(fieldName);
    return legacyOverrideValue;
  }
  return canonicalValue ?? null;
}

// ─── Meaningful Spread Detection (shared constant) ─────────────────────────

export const ARTIFACT_SPREAD_TYPES = new Set(["CLASSIC_PDF", "STANDARD"]);
