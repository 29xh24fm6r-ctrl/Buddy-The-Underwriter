/**
 * SPEC-M4 FIX-CARDS-1 — pure detector: raw deterministic signals in,
 * FixCardIssue[] out. No DB, no AI — buildFixCards.ts does the I/O and
 * attaches cached "why it matters" copy per issueType.
 *
 * Four sources, matching the program doc's list minus franchise Item 19
 * (out of scope for v1 — see buildFixCards.ts's doc comment):
 *   1. qualityFlags   — data-quality diagnostics (buildFinancialModel.ts)
 *   2. riskFlags      — threshold breaches (e.g. DSCR below minimum)
 *   3. checklistGaps  — required, unsatisfied deal_checklist_items rows
 *   4. reconciliation — ownership/K-1 mismatches (deal_reconciliation_results)
 *
 * v1 scope decision on riskFlags: rather than re-deriving which specific
 * EBITDA add-back is undocumented (would require re-resolving formType and
 * re-calling computeEbitda() live, a separate, under-verified integration),
 * a DSCR-related risk flag gets a generic, always-accurate resolving
 * action prompting for add-back documentation in general. Precise
 * per-add-back attribution is a fast-follow once that wiring is verified.
 */

export type FixCardSeverity = "info" | "warning" | "critical";

export type FixCardIssue = {
  /** Cache key for "why it matters" copy — see fixCardCopyCache.ts. Stable across deals. */
  issueType: string;
  severity: FixCardSeverity;
  /** Plain-English "what's wrong," deterministic (no LLM). */
  summary: string;
  /** The exact action/document that resolves this card. */
  resolvingAction: string;
  /** When set, completing this card should also satisfy this checklist item. */
  checklistKey?: string;
};

export type QualityFlagInput = string;

export type RiskFlagInput = {
  key: string;
  value: number;
  threshold: number;
  severity: string;
};

export type ChecklistGapInput = {
  checklistKey: string;
  label: string;
};

export type ReconciliationFailureInput = {
  checkId: string;
  description: string;
  severity: "HARD" | "SOFT";
  notes: string;
};

export type DetectFixCardIssuesInput = {
  qualityFlags: QualityFlagInput[];
  riskFlags: RiskFlagInput[];
  checklistGaps: ChecklistGapInput[];
  reconciliationFailures: ReconciliationFailureInput[];
};

function humanizeCode(code: string): string {
  // Strip any "KEY:param=value:..." suffix (e.g. BALANCE_SHEET_IMBALANCE:equity=plugged:...)
  const base = code.split(":")[0];
  return base
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function detectQualityFlagIssues(qualityFlags: QualityFlagInput[]): FixCardIssue[] {
  return qualityFlags.map((flag) => {
    const base = flag.split(":")[0];
    return {
      issueType: `quality_flag:${base}`,
      severity: "warning",
      summary: `We found a data-quality issue in your financials: ${humanizeCode(flag)}.`,
      resolvingAction:
        "Upload a clearer copy of your financial statements, or confirm the figures with your accountant.",
    };
  });
}

const DSCR_RISK_KEYS = new Set(["DSCR"]);

function detectRiskFlagIssues(riskFlags: RiskFlagInput[]): FixCardIssue[] {
  // Audit fix (Borrower Intake Program review): RiskSeverity
  // (src/lib/modelEngine/types.ts) is uppercase ("LOW"|"MEDIUM"|"HIGH"),
  // matching what's actually persisted to deal_model_snapshots.risk_flags
  // and read back verbatim by loadLatestSnapshotMetrics. Comparing against
  // lowercase literals here meant a HIGH-severity breach (e.g. DSCR below
  // minimum) was silently never mapped to "critical" — always downgraded
  // to "warning". Normalize before comparing so this doesn't depend on the
  // caller's exact casing.
  return riskFlags
    .filter((f) => f.severity.toUpperCase() !== "LOW")
    .map((flag) => {
      const isDscr = DSCR_RISK_KEYS.has(flag.key);
      return {
        issueType: `risk_flag:${flag.key}`,
        severity: flag.severity.toUpperCase() === "HIGH" ? "critical" : "warning",
        summary: `Your ${humanizeCode(flag.key)} of ${flag.value} is below the typical minimum of ${flag.threshold}.`,
        resolvingAction: isDscr
          ? "Upload documentation for any add-backs (bonus depreciation, one-time expenses, officer compensation adjustments) that support your cash flow calculation."
          : "Review this figure with your banker to understand what would help.",
      };
    });
}

function detectChecklistGapIssues(checklistGaps: ChecklistGapInput[]): FixCardIssue[] {
  return checklistGaps.map((gap) => ({
    issueType: `checklist_gap:${gap.checklistKey}`,
    severity: "info",
    summary: `We still need: ${gap.label}.`,
    resolvingAction: `Upload your ${gap.label}.`,
    checklistKey: gap.checklistKey,
  }));
}

function detectReconciliationIssues(failures: ReconciliationFailureInput[]): FixCardIssue[] {
  return failures.map((f) => ({
    issueType: `reconciliation:${f.checkId}`,
    severity: f.severity === "HARD" ? "critical" : "warning",
    summary: f.description,
    resolvingAction:
      "Provide corrected or additional ownership documentation (K-1s, cap table) so we can reconcile this.",
  }));
}

export function detectFixCardIssues(input: DetectFixCardIssuesInput): FixCardIssue[] {
  return [
    ...detectQualityFlagIssues(input.qualityFlags),
    ...detectRiskFlagIssues(input.riskFlags),
    ...detectChecklistGapIssues(input.checklistGaps),
    ...detectReconciliationIssues(input.reconciliationFailures),
  ];
}
