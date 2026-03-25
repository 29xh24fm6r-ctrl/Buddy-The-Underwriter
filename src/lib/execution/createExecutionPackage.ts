/**
 * Execution handoff — derives execution package from approved freeze snapshot.
 * ONLY reads from frozen/approved state, never from mutable builder state.
 * Pure module — no DB, no server-only.
 */

export type ExecutionPackage = {
  approved_structure: {
    loan_amount?: number;
    equity_pct?: number;
    equity_amount?: number;
    ltv?: number;
    lendable_value?: number;
    gross_collateral_value?: number;
    scenario_label?: string;
    path_type?: string;
  };
  approved_exceptions: Array<{
    key: string;
    type: string;
    title: string;
    status: string;
    mitigants: string[];
  }>;
  approved_mitigants: string[];
  pricing_inputs: {
    loan_amount?: number;
    collateral_value?: number;
    ltv?: number;
    equity_pct?: number;
  };
  borrower_summary: string;
  decision_type: string;
  decision_notes?: string;
  freeze_id: string;
  decision_id?: string;
};

export function createExecutionPackage(args: {
  frozenBuilderState: Record<string, unknown>;
  frozenSelectionSnapshot: Record<string, unknown>;
  frozenExceptions: unknown[];
  frozenDecisions: unknown[];
  committeeDecision: { decision: string; decision_notes?: string | null; id?: string };
  freezeId: string;
}): ExecutionPackage {
  const { frozenBuilderState, frozenSelectionSnapshot, frozenExceptions, committeeDecision, freezeId } = args;

  const scenario = frozenSelectionSnapshot as any;
  const dealSection = (frozenBuilderState as any)?.deal ?? {};

  // Extract structure metrics from frozen scenario
  const structure = {
    loan_amount: scenario.projected_loan_amount ?? dealSection.requested_amount,
    equity_pct: scenario.projected_equity_pct,
    equity_amount: scenario.projected_equity_amount,
    ltv: scenario.projected_ltv,
    lendable_value: scenario.projected_lendable_value,
    gross_collateral_value: scenario.projected_gross_collateral_value,
    scenario_label: scenario.label,
    path_type: scenario.path_type,
  };

  // Extract exceptions and mitigants from frozen state
  const exceptions = (frozenExceptions as any[]).map((e) => ({
    key: e.exception_key ?? e.type ?? "unknown",
    type: e.exception_type ?? e.type ?? "unknown",
    title: e.title ?? e.description ?? "Unknown exception",
    status: e.status ?? "open",
    mitigants: [] as string[],
  }));

  const allMitigants: string[] = [];
  for (const exc of frozenExceptions as any[]) {
    if (exc.mitigants && Array.isArray(exc.mitigants)) {
      allMitigants.push(...exc.mitigants);
    }
  }

  // Borrower summary
  const borrowerParts: string[] = [];
  if (structure.loan_amount) {
    borrowerParts.push(`Approved loan: $${structure.loan_amount.toLocaleString()}`);
  }
  if (structure.equity_pct) {
    borrowerParts.push(`Required equity: ${(structure.equity_pct * 100).toFixed(0)}%`);
  }
  if (committeeDecision.decision === "approved") {
    borrowerParts.push("Structure approved within policy.");
  } else if (committeeDecision.decision === "approved_with_exceptions") {
    borrowerParts.push("Structure approved with documented policy exceptions.");
  } else if (committeeDecision.decision === "approved_with_changes") {
    borrowerParts.push("Structure approved with committee-required modifications.");
  }

  return {
    approved_structure: structure,
    approved_exceptions: exceptions,
    approved_mitigants: allMitigants,
    pricing_inputs: {
      loan_amount: structure.loan_amount,
      collateral_value: structure.gross_collateral_value,
      ltv: structure.ltv,
      equity_pct: structure.equity_pct,
    },
    borrower_summary: borrowerParts.join(" "),
    decision_type: committeeDecision.decision,
    decision_notes: committeeDecision.decision_notes ?? undefined,
    freeze_id: freezeId,
    decision_id: committeeDecision.id,
  };
}
