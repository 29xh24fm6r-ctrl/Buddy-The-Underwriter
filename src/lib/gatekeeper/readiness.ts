/**
 * Gatekeeper Readiness — Fact Matching Engine (PURE)
 *
 * Determines underwriting completeness by matching gatekeeper-classified
 * documents against scenario requirements.
 *
 * No DB, no IO, no side effects. Fully testable.
 *
 * Key design decisions:
 * - PFS is tracked in `missing` but EXCLUDED from `readinessPct`
 *   (gatekeeper taxonomy does not include PFS)
 * - Present year counts are capped at required count (no > 100%)
 * - W2 / FORM_1099 / K1 count as PERSONAL_TAX_RETURN via effective type mapping
 * - NEEDS_REVIEW docs are counted separately and prevent `ready: true`
 */

import type { ScenarioRequirements } from "./requirements";
import { mapGatekeeperDocTypeToEffectiveDocType } from "./routing";
import type { GatekeeperDocType } from "./types";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Input document row from gatekeeper-classified deal_documents */
export type GatekeeperDocRow = {
  gatekeeper_doc_type: string;
  gatekeeper_tax_year: number | null;
  gatekeeper_needs_review: boolean;
};

export type GatekeeperReadinessResult = {
  required: {
    businessTaxYears: number[];
    personalTaxYears: number[];
    requiresFinancialStatements: boolean;
    requiresPFS: boolean;
  };

  present: {
    businessTaxYears: number[];
    personalTaxYears: number[];
    financialStatementsPresent: boolean;
    pfsPresent: boolean;
  };

  missing: {
    businessTaxYears: number[];
    personalTaxYears: number[];
    financialStatementsMissing: boolean;
    pfsMissing: boolean;
  };

  needsReviewCount: number;
  readinessPct: number;
  ready: boolean;
};

// ─── Matching Engine ─────────────────────────────────────────────────────────

/**
 * Compute gatekeeper-derived readiness from requirements + classified documents.
 *
 * Matching rules:
 * - Business Tax Returns: exact year matching against BUSINESS_TAX_RETURN docs
 * - Personal Tax Returns: exact year matching against PERSONAL_TAX_RETURN effective type
 *   (includes W2, FORM_1099, K1)
 * - Financial Statements: present if any FINANCIAL_STATEMENT doc exists
 * - PFS: always false (not in gatekeeper taxonomy), excluded from readinessPct
 *
 * Readiness formula (PFS excluded):
 *   eligibleRequired = BTR years + PTR years + (FS ? 1 : 0)
 *   eligibleMatched  = present BTR years + present PTR years + (FS present ? 1 : 0)
 *   readinessPct     = eligibleMatched / eligibleRequired * 100
 *   ready            = readinessPct === 100 && needsReviewCount === 0
 */
export function computeGatekeeperReadiness(params: {
  requirements: ScenarioRequirements;
  documents: GatekeeperDocRow[];
}): GatekeeperReadinessResult {
  const { requirements, documents } = params;

  // Partition documents: non-review (usable) vs review (counted)
  const usableDocs = documents.filter((d) => !d.gatekeeper_needs_review);
  const needsReviewCount = documents.filter((d) => d.gatekeeper_needs_review).length;

  // Map each usable doc to its effective type
  const effectiveDocs = usableDocs.map((d) => ({
    effectiveDocType: mapGatekeeperDocTypeToEffectiveDocType(
      d.gatekeeper_doc_type as GatekeeperDocType,
    ),
    taxYear: d.gatekeeper_tax_year,
  }));

  // ── Business Tax Returns ──────────────────────────────────────────────────

  const presentBtrYears = new Set<number>();
  for (const doc of effectiveDocs) {
    if (doc.effectiveDocType === "BUSINESS_TAX_RETURN" && doc.taxYear != null) {
      presentBtrYears.add(doc.taxYear);
    }
  }

  // Only count years that are actually required (cap to prevent > 100%)
  const matchedBtrYears = requirements.businessTaxYears.filter((y) =>
    presentBtrYears.has(y),
  );
  const missingBtrYears = requirements.businessTaxYears.filter(
    (y) => !presentBtrYears.has(y),
  );

  // ── Personal Tax Returns ──────────────────────────────────────────────────

  const presentPtrYears = new Set<number>();
  for (const doc of effectiveDocs) {
    if (doc.effectiveDocType === "PERSONAL_TAX_RETURN" && doc.taxYear != null) {
      presentPtrYears.add(doc.taxYear);
    }
  }

  const matchedPtrYears = requirements.personalTaxYears.filter((y) =>
    presentPtrYears.has(y),
  );
  const missingPtrYears = requirements.personalTaxYears.filter(
    (y) => !presentPtrYears.has(y),
  );

  // ── Financial Statements ──────────────────────────────────────────────────

  const financialStatementsPresent = effectiveDocs.some(
    (d) => d.effectiveDocType === "FINANCIAL_STATEMENT",
  );
  const financialStatementsMissing =
    requirements.requiresFinancialStatements && !financialStatementsPresent;

  // ── PFS (not in gatekeeper taxonomy — tracked but excluded from %) ────────

  const pfsPresent = false;
  const pfsMissing = requirements.requiresPFS;

  // ── Readiness Formula (PFS excluded) ──────────────────────────────────────

  const eligibleRequiredCount =
    requirements.businessTaxYears.length +
    requirements.personalTaxYears.length +
    (requirements.requiresFinancialStatements ? 1 : 0);

  const eligibleMatchedCount =
    matchedBtrYears.length +
    matchedPtrYears.length +
    (requirements.requiresFinancialStatements && financialStatementsPresent
      ? 1
      : 0);

  const readinessPct =
    eligibleRequiredCount === 0
      ? 100
      : (eligibleMatchedCount / eligibleRequiredCount) * 100;

  const ready = readinessPct === 100 && needsReviewCount === 0;

  return {
    required: {
      businessTaxYears: requirements.businessTaxYears,
      personalTaxYears: requirements.personalTaxYears,
      requiresFinancialStatements: requirements.requiresFinancialStatements,
      requiresPFS: requirements.requiresPFS,
    },
    present: {
      businessTaxYears: matchedBtrYears,
      personalTaxYears: matchedPtrYears,
      financialStatementsPresent,
      pfsPresent,
    },
    missing: {
      businessTaxYears: missingBtrYears,
      personalTaxYears: missingPtrYears,
      financialStatementsMissing,
      pfsMissing,
    },
    needsReviewCount,
    readinessPct,
    ready,
  };
}
