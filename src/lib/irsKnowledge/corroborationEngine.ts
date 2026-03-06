/**
 * Proof-of-Correctness — Multi-Source Corroboration Engine
 *
 * Cross-checks key facts against secondary sources within the document set.
 * Pure function — no DB calls.
 */

import type { IrsFormType } from "./types";

export type CorroborationResult = {
  checkId: string;
  factKey: string;
  primaryValue: number | null;
  secondaryValue: number | null;
  delta: number | null;
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
};

type FactMap = Record<string, number | null>;

type CorroborationCheck = {
  checkId: string;
  factKey: string;
  /** Key to look up in the primary document's facts */
  primaryKey: string;
  /** Key to look up in all document facts (secondary source) */
  secondaryKey: string;
  /** Description used as skip reason prefix */
  description: string;
};

const FORM_1065_CHECKS: CorroborationCheck[] = [
  {
    checkId: "1065_GROSS_RECEIPTS_PAGE1_VS_SCHEDULE_K",
    factKey: "GROSS_RECEIPTS",
    primaryKey: "GROSS_RECEIPTS",
    secondaryKey: "K_GROSS_RECEIPTS",
    description: "Page 1 gross receipts vs Schedule K",
  },
  {
    checkId: "1065_OBI_PAGE1_VS_K1_SUM",
    factKey: "ORDINARY_BUSINESS_INCOME",
    primaryKey: "ORDINARY_BUSINESS_INCOME",
    secondaryKey: "K1_ORDINARY_INCOME_SUM",
    description: "Page 1 OBI vs sum of K-1s",
  },
  {
    checkId: "1065_DEPRECIATION_PAGE1_VS_4562",
    factKey: "DEPRECIATION",
    primaryKey: "DEPRECIATION",
    secondaryKey: "FORM4562_DEPRECIATION",
    description: "Page 1 depreciation vs Form 4562",
  },
  {
    checkId: "1065_TOTAL_ASSETS_SCHEDULE_L",
    factKey: "TOTAL_ASSETS",
    primaryKey: "TOTAL_ASSETS",
    secondaryKey: "SCHEDULE_L_TOTAL_ASSETS",
    description: "Schedule L total assets vs reported",
  },
];

const FORM_1120_CHECKS: CorroborationCheck[] = [
  {
    checkId: "1120_TOTAL_ASSETS_SCHEDULE_L",
    factKey: "TOTAL_ASSETS",
    primaryKey: "TOTAL_ASSETS",
    secondaryKey: "SCHEDULE_L_TOTAL_ASSETS",
    description: "Schedule L total assets vs balance sheet",
  },
  {
    checkId: "1120_OFFICER_COMP_VS_1125E",
    factKey: "OFFICER_COMPENSATION",
    primaryKey: "OFFICER_COMPENSATION",
    secondaryKey: "FORM1125E_OFFICER_COMP",
    description: "Page 1 officer comp vs Form 1125-E",
  },
];

function getChecksForForm(formType: IrsFormType): CorroborationCheck[] {
  switch (formType) {
    case "FORM_1065":
      return FORM_1065_CHECKS;
    case "FORM_1120":
    case "FORM_1120S":
      return FORM_1120_CHECKS;
    default:
      return [];
  }
}

/**
 * Cross-check key facts against secondary sources within the document set.
 *
 * Agreement within $1 = PASSED. Disagreement = FAILED with both values.
 * If secondary source not available = SKIPPED (not a failure).
 *
 * @param documentId - UUID of the source document
 * @param formType - IRS form type
 * @param facts - Primary document's extracted facts
 * @param allDocumentFacts - Facts from all documents in the deal (includes secondary sources)
 */
export function corroborateDocumentFacts(
  documentId: string,
  formType: IrsFormType,
  facts: FactMap,
  allDocumentFacts: FactMap,
): CorroborationResult[] {
  const checks = getChecksForForm(formType);

  return checks.map((check): CorroborationResult => {
    const primaryValue = facts[check.primaryKey] ?? null;
    const secondaryValue = allDocumentFacts[check.secondaryKey] ?? null;

    // Skip if primary source is missing
    if (primaryValue === null) {
      return {
        checkId: check.checkId,
        factKey: check.factKey,
        primaryValue: null,
        secondaryValue,
        delta: null,
        passed: false,
        skipped: true,
        skipReason: `Primary value not available for ${check.factKey}`,
      };
    }

    // Skip if secondary source is missing
    if (secondaryValue === null) {
      return {
        checkId: check.checkId,
        factKey: check.factKey,
        primaryValue,
        secondaryValue: null,
        delta: null,
        passed: false,
        skipped: true,
        skipReason: `Secondary source not available: ${check.description}`,
      };
    }

    const delta = Math.abs(primaryValue - secondaryValue);
    const passed = delta <= 1;

    return {
      checkId: check.checkId,
      factKey: check.factKey,
      primaryValue,
      secondaryValue,
      delta,
      passed,
      skipped: false,
    };
  });
}
