/**
 * Banker Review Readiness — Canonical-First Required Completion Checks
 *
 * Determines whether required memo fields are satisfied from canonical
 * memo data before falling back to legacy override fields.
 *
 * Pure function — no DB, no server-only. Safe for client components.
 */

import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";

const MIN_BIO_LENGTH = 20;
const MIN_DESC_LENGTH = 20;

/**
 * Check whether business description/profile is available from any canonical source.
 */
export function hasMemoBusinessDescription(
  memo: CanonicalCreditMemoV1,
  overrides: Record<string, unknown>,
): boolean {
  // 1. Canonical borrower story / business description
  const desc = memo.business_summary?.business_description;
  if (typeof desc === "string" && desc.trim().length >= MIN_DESC_LENGTH && !desc.startsWith("Pending") && !desc.includes("Data unavailable")) {
    return true;
  }

  // 2. Canonical banker context with business information
  if (memo.banker_context?.banker_notes && memo.banker_context.banker_notes.trim().length >= MIN_DESC_LENGTH) {
    return true;
  }

  // 3. Legacy override fallback
  const overrideDesc = overrides.business_description;
  if (typeof overrideDesc === "string" && overrideDesc.trim().length >= MIN_DESC_LENGTH) {
    return true;
  }

  return false;
}

/**
 * Check whether at least one management profile has a real bio/narrative.
 */
export function hasMemoManagementBio(
  memo: CanonicalCreditMemoV1,
  overrides: Record<string, unknown>,
): boolean {
  // 1. Canonical management principals with real bios
  for (const p of memo.management_qualifications.principals) {
    if (typeof p.bio === "string" && p.bio.trim().length >= MIN_BIO_LENGTH && !p.bio.startsWith("Pending")) {
      return true;
    }
  }

  // 2. Legacy override fallback: principal_bio_*
  const principalIds = memo.management_qualifications.principals.map((p) => p.id);
  for (const pid of principalIds) {
    const v = overrides[`principal_bio_${pid}`];
    if (typeof v === "string" && v.trim().length >= MIN_BIO_LENGTH) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether collateral is adequately described, including AR borrowing base.
 */
export function hasMemoCollateral(memo: CanonicalCreditMemoV1): boolean {
  // 1. AR borrowing base exists
  if (memo.collateral.ar_borrowing_base) return true;

  // 2. AR-specific collateral line item
  if (memo.collateral.line_items.some((li) => li.description.includes("AR") || li.description.includes("Accounts Receivable"))) {
    return true;
  }

  // 3. Gross collateral value exists
  if (memo.collateral.gross_value.value !== null && memo.collateral.gross_value.value > 0) {
    return true;
  }

  return false;
}

/**
 * Check whether the AI narrative has actually been generated for this memo.
 * A banker must not be able to submit to underwriting on a memo whose
 * narrative sections were never generated/reviewed — that content becomes
 * part of the frozen banker-certified snapshot.
 */
export function hasMemoNarrative(memo: CanonicalCreditMemoV1): boolean {
  const narrative = memo.executive_summary?.narrative;
  return (
    typeof narrative === "string" &&
    narrative.length > 0 &&
    !narrative.toLowerCase().includes("not yet generated")
  );
}

/**
 * SPEC-CREDIT-MEMO-PERFECTION-PROGRAM-1 Phase 1: committee readiness gate. Satisfied
 * when there is no committee model (research not run → gate n/a), when committee is
 * ready, or when a banker recorded an override reason
 * (overrides["committee_not_ready_override"]). Shared by the UI checklist and the
 * server contract so they never diverge.
 */
export function hasCommitteeReadinessOrOverride(
  memo: CanonicalCreditMemoV1,
  overrides: Record<string, unknown>,
): boolean {
  const cr = memo.committee_readiness;
  if (!cr) return true;
  if (cr.committee_ready) return true;
  const ov = overrides["committee_not_ready_override"];
  return typeof ov === "string" && ov.trim().length > 0;
}

/**
 * Build the required items list using canonical-first checks.
 */
export type RequiredItem = {
  id: string;
  ok: boolean;
  label: string;
};

export function buildRequiredItems(
  memo: CanonicalCreditMemoV1,
  overrides: Record<string, unknown>,
): RequiredItem[] {
  return [
    {
      id: "dscr",
      ok: memo.financial_analysis.dscr.value !== null,
      label: "DSCR computed",
    },
    {
      id: "loan",
      ok: memo.key_metrics.loan_amount.value !== null && memo.key_metrics.loan_amount.value > 0,
      label: "Loan amount entered",
    },
    {
      id: "collat",
      ok: hasMemoCollateral(memo),
      label: "Collateral available",
    },
    {
      id: "bizdesc",
      ok: hasMemoBusinessDescription(memo, overrides),
      label: "Business profile available",
    },
    {
      id: "mgmtbio",
      ok: hasMemoManagementBio(memo, overrides),
      label: "Management profile available",
    },
    {
      id: "narrative",
      ok: hasMemoNarrative(memo),
      label: "AI narrative generated",
    },
    {
      id: "committee",
      ok: hasCommitteeReadinessOrOverride(memo, overrides),
      label: "Committee readiness met",
    },
  ];
}
