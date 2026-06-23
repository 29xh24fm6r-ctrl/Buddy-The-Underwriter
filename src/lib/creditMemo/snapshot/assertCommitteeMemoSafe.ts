/**
 * assertCommitteeMemoSafe
 *
 * Final committee-artifact guardrail. Throws FloridaArmoryBuildError with code
 * "committee_artifact_unsafe" if the certified snapshot would still render an
 * unsafe committee PDF — meaning bad memo state must NOT reach committee.
 *
 * Spec: SPEC — Make Florida Armory Snapshot the Only Committee Memo Source of Truth
 *
 * Checks (all required):
 * - schema_version === "florida_armory_v1"
 * - meta.render_mode === "committee"
 * - banker_submission.certification === true
 * - all 20 Florida Armory sections exist (FLORIDA_ARMORY_SECTION_KEYS)
 * - diagnostics.readiness_contract.passed === true
 * - diagnostics.warnings.length === 0
 * - no recursive Pending / Unknown / Generating / "Unable to compute" /
 *   "Conclusion pending" / standalone em-dash or dash placeholders in any
 *   string value
 * - no DSCR contradiction (recommendation says "DSCR missing" while
 *   financial_analysis.dscr.value is non-null)
 * - AR LOC memos must include borrowing-base / AR aging / eligible AR
 *
 * Pure function. No DB / network calls.
 */

import {
  FLORIDA_ARMORY_SECTION_KEYS,
  FloridaArmoryBuildError,
  type FloridaArmoryMemoSnapshot,
  type FloridaArmorySectionKey,
} from "@/lib/creditMemo/snapshot/types";

// ---------------------------------------------------------------------------
// Forbidden placeholder detection
// ---------------------------------------------------------------------------

/**
 * Phrases that indicate the artifact is incomplete and must NOT render to
 * committee. The check is case-insensitive substring match against any string
 * value reached by deep traversal of the snapshot.
 */
const FORBIDDEN_PLACEHOLDER_PHRASES = [
  "pending",
  "unknown",
  "generating",
  "unable to compute",
  "conclusion pending",
] as const;

/**
 * Standalone em-dash / dash placeholder values. Used by formatters when data
 * is missing. Must NOT appear in a committee artifact.
 */
const STANDALONE_DASH_VALUES = new Set(["—", "-", "--", "n/a", "tbd"]);

function isStandalonePlaceholder(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return false;
  return STANDALONE_DASH_VALUES.has(trimmed);
}

function isForbiddenPhrase(value: string): boolean {
  const lower = value.toLowerCase();
  for (const phrase of FORBIDDEN_PLACEHOLDER_PHRASES) {
    if (lower.includes(phrase)) return true;
  }
  return false;
}

type ForbiddenHit = { path: string; value: string };

function findForbiddenStrings(
  root: unknown,
  pathPrefix: string,
  acc: ForbiddenHit[],
  /** Limit how many hits we record so we don't blow up on huge memos */
  maxHits = 25,
): void {
  if (acc.length >= maxHits) return;
  if (root === null || root === undefined) return;
  const valueType = typeof root;
  if (valueType === "string") {
    const str = root as string;
    if (isStandalonePlaceholder(str) || isForbiddenPhrase(str)) {
      acc.push({ path: pathPrefix || "(root)", value: str });
    }
    return;
  }
  if (valueType !== "object") return;
  if (Array.isArray(root)) {
    for (let i = 0; i < root.length; i++) {
      if (acc.length >= maxHits) return;
      findForbiddenStrings(root[i], `${pathPrefix}[${i}]`, acc, maxHits);
    }
    return;
  }
  for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
    if (acc.length >= maxHits) return;
    const next = pathPrefix ? `${pathPrefix}.${k}` : k;
    findForbiddenStrings(v, next, acc, maxHits);
  }
}

// ---------------------------------------------------------------------------
// AR LOC detection
// ---------------------------------------------------------------------------

function isArLineOfCreditMemo(snapshot: FloridaArmoryMemoSnapshot): boolean {
  const canonical = snapshot.canonical_memo;
  if (!canonical) return false;
  const haystacks: string[] = [];
  const product = canonical.transaction_overview?.loan_request?.product;
  if (product) haystacks.push(String(product));
  const proposedProduct = canonical.proposed_terms?.product;
  if (proposedProduct) haystacks.push(String(proposedProduct));
  const purpose = canonical.transaction_overview?.loan_request?.purpose;
  if (purpose) haystacks.push(String(purpose));
  const lower = haystacks.join(" ").toLowerCase();
  if (lower.length === 0) return false;
  // Match any of: "ar loc", "accounts receivable line", "a/r line",
  // "asset-based loc", "asset based loc", "line of credit secured by ar".
  if (/\b(a\/?r|accounts\s+receivable)[^\n]{0,80}(loc|line\s+of\s+credit)/.test(lower))
    return true;
  if (/\b(loc|line\s+of\s+credit)[^\n]{0,80}(a\/?r|accounts\s+receivable)/.test(lower))
    return true;
  if (/asset[-\s]based[^\n]{0,40}(loc|line\s+of\s+credit)/.test(lower)) return true;
  return false;
}

function arLocHasBorrowingBaseAnalysis(snapshot: FloridaArmoryMemoSnapshot): boolean {
  // Combine the most likely textual surfaces and look for borrowing-base /
  // AR aging / eligible AR signals. We require ALL three to be present.
  const fa = snapshot.canonical_memo?.financial_analysis;
  const colNarrative =
    snapshot.canonical_memo?.collateral?.property_description ?? "";
  const incomeNarrative = fa?.income_analysis ?? "";
  const repaymentNotes = (fa?.repayment_notes ?? []).join(" ");
  const projection = fa?.projection_feasibility ?? "";
  const recRationale = (snapshot.canonical_memo?.recommendation?.rationale ?? []).join(
    " ",
  );
  const sectionNarratives: string[] = [];
  for (const key of FLORIDA_ARMORY_SECTION_KEYS) {
    const section = snapshot.sections[key];
    if (!section) continue;
    if (typeof section.narrative === "string") sectionNarratives.push(section.narrative);
  }
  const haystack = [
    colNarrative,
    incomeNarrative,
    repaymentNotes,
    projection,
    recRationale,
    sectionNarratives.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const hasBorrowingBase = /borrowing\s+base/.test(haystack);
  const hasArAging = /(a\/?r|accounts\s+receivable)\s+aging/.test(haystack);
  const hasEligibleAr = /eligible\s+(a\/?r|accounts\s+receivable|receivables)/.test(
    haystack,
  );
  return hasBorrowingBase && hasArAging && hasEligibleAr;
}

// ---------------------------------------------------------------------------
// DSCR contradiction detection
// ---------------------------------------------------------------------------

function hasDscrContradiction(snapshot: FloridaArmoryMemoSnapshot): boolean {
  const fa = snapshot.canonical_memo?.financial_analysis;
  const dscrValue = fa?.dscr?.value ?? null;
  if (dscrValue === null) return false;
  const rec = snapshot.canonical_memo?.recommendation;
  if (!rec) return false;
  const surfaces: string[] = [];
  if (typeof rec.headline === "string") surfaces.push(rec.headline);
  if (Array.isArray(rec.rationale)) surfaces.push(...rec.rationale);
  if (Array.isArray(rec.key_drivers)) surfaces.push(...rec.key_drivers);
  const lower = surfaces.join(" ").toLowerCase();
  if (lower.length === 0) return false;
  return /\bdscr\b[^.]{0,40}(missing|unavailable|unknown|not\s+available|pending)/.test(
    lower,
  );
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------

export function assertCommitteeMemoSafe(
  snapshot: FloridaArmoryMemoSnapshot,
): void {
  const missing: string[] = [];

  // 1. Schema + render-mode invariants
  if (!snapshot || typeof snapshot !== "object") {
    throw new FloridaArmoryBuildError("committee_artifact_unsafe", [
      "snapshot_missing",
    ]);
  }
  if (snapshot.schema_version !== "florida_armory_v1") {
    missing.push("schema_version!=florida_armory_v1");
  }
  if (!snapshot.meta || snapshot.meta.render_mode !== "committee") {
    missing.push("meta.render_mode!=committee");
  }

  // 2. Banker certification invariant
  if (!snapshot.banker_submission || snapshot.banker_submission.certification !== true) {
    missing.push("banker_submission.certification!=true");
  }

  // 3. All 20 Florida Armory sections present
  if (!snapshot.sections || typeof snapshot.sections !== "object") {
    missing.push("sections.missing");
  } else {
    for (const key of FLORIDA_ARMORY_SECTION_KEYS) {
      const section = (snapshot.sections as Record<FloridaArmorySectionKey, unknown>)[key];
      if (!section || typeof section !== "object") {
        missing.push(`sections.${key}.missing`);
      }
    }
  }

  // 4. Readiness contract passed
  if (
    !snapshot.diagnostics ||
    !snapshot.diagnostics.readiness_contract ||
    snapshot.diagnostics.readiness_contract.passed !== true
  ) {
    missing.push("diagnostics.readiness_contract.passed!=true");
  }

  // 5. Diagnostics warnings empty
  if (
    !snapshot.diagnostics ||
    !Array.isArray(snapshot.diagnostics.warnings) ||
    snapshot.diagnostics.warnings.length !== 0
  ) {
    missing.push("diagnostics.warnings.length!=0");
  }

  // 6. Recursive forbidden-placeholder scan across the snapshot
  const hits: ForbiddenHit[] = [];
  findForbiddenStrings(snapshot, "", hits);
  for (const hit of hits.slice(0, 10)) {
    missing.push(`placeholder:${hit.path}:${hit.value.slice(0, 32)}`);
  }

  // 7. DSCR contradiction
  if (hasDscrContradiction(snapshot)) {
    missing.push("dscr_contradiction");
  }

  // 8. AR LOC must include borrowing-base / AR aging / eligible AR
  if (isArLineOfCreditMemo(snapshot) && !arLocHasBorrowingBaseAnalysis(snapshot)) {
    missing.push("ar_loc_missing_borrowing_base_analysis");
  }

  if (missing.length > 0) {
    throw new FloridaArmoryBuildError("committee_artifact_unsafe", missing);
  }
}

// Re-exported for tests / direct probing.
export const __internal = {
  FORBIDDEN_PLACEHOLDER_PHRASES,
  STANDALONE_DASH_VALUES,
  findForbiddenStrings,
  isArLineOfCreditMemo,
  arLocHasBorrowingBaseAnalysis,
  hasDscrContradiction,
};
