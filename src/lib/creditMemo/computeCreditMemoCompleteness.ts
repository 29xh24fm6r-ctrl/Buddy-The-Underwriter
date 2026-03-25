/**
 * Deterministic credit memo completeness gate.
 * Pure module — no DB, no server-only.
 */

export type CreditMemoCompleteness = {
  complete: boolean;
  pct: number;
  missing_sections: string[];
  warnings: string[];
};

/** Minimum required memo sections for committee readiness */
const REQUIRED_SECTIONS = [
  { key: "transaction_summary", label: "Transaction Summary" },
  { key: "borrower_summary", label: "Borrower / Ownership Summary" },
  { key: "management_story", label: "Management / Story" },
  { key: "collateral_analysis", label: "Collateral Analysis" },
  { key: "policy_exception_analysis", label: "Policy / Exception Analysis" },
  { key: "mitigants", label: "Mitigants" },
  { key: "recommendation_summary", label: "Recommendation / Structure Summary" },
  { key: "approval_considerations", label: "Approval Considerations" },
] as const;

const COMPLETENESS_THRESHOLD = 0.75;

/**
 * Compute memo completeness from available memo sections.
 * @param memoSections - map of section key to content (truthy = present)
 */
export function computeCreditMemoCompleteness(
  memoSections: Record<string, string | null | undefined>,
): CreditMemoCompleteness {
  const missing: string[] = [];
  const warnings: string[] = [];
  let present = 0;

  for (const section of REQUIRED_SECTIONS) {
    const content = memoSections[section.key];
    if (!content || content.trim().length < 20) {
      missing.push(section.label);
    } else {
      present++;
      // Warn on very short sections
      if (content.trim().length < 80) {
        warnings.push(`${section.label} may be too brief (${content.trim().length} chars)`);
      }
    }
  }

  const pct = Math.round((present / REQUIRED_SECTIONS.length) * 100);

  return {
    complete: pct / 100 >= COMPLETENESS_THRESHOLD && missing.length <= 1,
    pct,
    missing_sections: missing,
    warnings,
  };
}

export { REQUIRED_SECTIONS, COMPLETENESS_THRESHOLD };
