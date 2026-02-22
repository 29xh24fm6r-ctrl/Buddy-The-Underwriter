/**
 * Buddy Institutional Document Matching Engine v1 — Negative Rules
 *
 * Pure function. No server-only, no DB, no IO.
 *
 * Any blocked rule = slot is forbidden. Cannot be overridden by confidence.
 * 11 hard-blocking rules. FINANCIAL_STATEMENT cannot auto-match any slot.
 */

import type {
  DocumentIdentity,
  SlotSnapshot,
  NegativeRuleResult,
} from "./types";

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

type NegativeRule = {
  ruleId: string;
  evaluate: (identity: DocumentIdentity, slot: SlotSnapshot) => boolean;
  reason: string;
};

const NEGATIVE_RULES: NegativeRule[] = [
  {
    ruleId: "K1_NOT_BTR",
    evaluate: (id, slot) =>
      id.rawDocType === "K1" &&
      slot.requiredDocType === "BUSINESS_TAX_RETURN",
    reason: "K-1 cannot fill a Business Tax Return slot",
  },
  {
    ruleId: "W2_NOT_BTR",
    evaluate: (id, slot) =>
      id.rawDocType === "W2" &&
      slot.requiredDocType === "BUSINESS_TAX_RETURN",
    reason: "W-2 cannot fill a Business Tax Return slot",
  },
  {
    ruleId: "1099_NOT_BTR",
    evaluate: (id, slot) =>
      (id.rawDocType === "1099" || id.rawDocType === "FORM_1099") &&
      slot.requiredDocType === "BUSINESS_TAX_RETURN",
    reason: "Form 1099 cannot fill a Business Tax Return slot",
  },
  {
    ruleId: "PERSONAL_NOT_BTR",
    evaluate: (id, slot) =>
      id.entityType === "personal" &&
      slot.requiredDocType === "BUSINESS_TAX_RETURN" &&
      // K-1, W-2, 1099 handled by their own rules above
      id.rawDocType !== "K1" &&
      id.rawDocType !== "W2" &&
      id.rawDocType !== "1099" &&
      id.rawDocType !== "FORM_1099",
    reason: "Personal entity document cannot fill a Business Tax Return slot",
  },
  {
    ruleId: "BUSINESS_NOT_PTR",
    evaluate: (id, slot) =>
      id.entityType === "business" &&
      slot.requiredDocType === "PERSONAL_TAX_RETURN",
    reason: "Business entity document cannot fill a Personal Tax Return slot",
  },
  {
    ruleId: "FIN_STMT_NOT_PFS",
    evaluate: (id, slot) =>
      (id.effectiveDocType === "FINANCIAL_STATEMENT" ||
        id.effectiveDocType === "INCOME_STATEMENT" ||
        id.effectiveDocType === "BALANCE_SHEET") &&
      slot.requiredDocType === "PERSONAL_FINANCIAL_STATEMENT",
    reason: "Financial Statement cannot fill a PFS slot",
  },
  {
    ruleId: "PFS_NOT_IS_BS",
    evaluate: (id, slot) =>
      (id.effectiveDocType === "PFS" ||
        id.effectiveDocType === "PERSONAL_FINANCIAL_STATEMENT") &&
      (slot.requiredDocType === "INCOME_STATEMENT" ||
        slot.requiredDocType === "BALANCE_SHEET"),
    reason: "PFS cannot fill an Income Statement or Balance Sheet slot",
  },
  {
    ruleId: "NO_YEAR_NO_YEAR_SLOT",
    evaluate: (id, slot) => {
      if (id.taxYear != null || slot.requiredTaxYear == null) return false;
      // v1.3: period-based year also satisfies this rule
      if (id.period) {
        const startYear = id.period.periodStart ? parseInt(id.period.periodStart.substring(0, 4), 10) : NaN;
        const endYear = id.period.periodEnd ? parseInt(id.period.periodEnd.substring(0, 4), 10) : NaN;
        if (Number.isFinite(startYear) || Number.isFinite(endYear)) return false;
      }
      return true;
    },
    reason: "Document has no tax year (or period year) but slot requires a specific year",
  },
  {
    ruleId: "BTR_NOT_PTR",
    evaluate: (id, slot) =>
      (id.effectiveDocType === "BUSINESS_TAX_RETURN" ||
        id.effectiveDocType === "IRS_BUSINESS") &&
      slot.requiredDocType === "PERSONAL_TAX_RETURN",
    reason: "Business Tax Return cannot fill a Personal Tax Return slot",
  },
  {
    ruleId: "PTR_NOT_BTR",
    evaluate: (id, slot) =>
      (id.effectiveDocType === "PERSONAL_TAX_RETURN" ||
        id.effectiveDocType === "IRS_PERSONAL") &&
      slot.requiredDocType === "BUSINESS_TAX_RETURN",
    reason: "Personal Tax Return cannot fill a Business Tax Return slot",
  },
  {
    ruleId: "UMBRELLA_NO_AUTO_MATCH",
    evaluate: (id) =>
      id.effectiveDocType === "FINANCIAL_STATEMENT",
    reason:
      "FINANCIAL_STATEMENT umbrella type cannot auto-match any slot — routes to review",
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate all negative rules for a (document, slot) pair.
 * Any blocked result = slot is forbidden.
 */
export function evaluateNegativeRules(
  identity: DocumentIdentity,
  slot: SlotSnapshot,
): NegativeRuleResult[] {
  return NEGATIVE_RULES.map((rule) => ({
    blocked: rule.evaluate(identity, slot),
    ruleId: rule.ruleId,
    reason: rule.reason,
  }));
}

/** Total count of negative rules (used by tripwires). */
export const NEGATIVE_RULE_COUNT = NEGATIVE_RULES.length;
