/** Central classification survives serialized workflow errors and gateway wrappers. */
export type FactoryFailureKind = "waiting_for_budget" | "configuration" | "needs_input" | "review_blocked" | "stale_input" | "transient";
export function classifyFactoryFailure(error: unknown): { kind: FactoryFailureKind; retryable: boolean; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const kind: FactoryFailureKind = /budget exceeded|budget_unavailable|run_allowance_exceeded/i.test(message) ? "waiting_for_budget"
    : /insufficient_quota|credit_balance_exhausted|invalid.api.key|NPI.*(approval|approved)|unauthorized|permission denied/i.test(message) ? "configuration"
    : /input_snapshot_changed|snapshot_schema_superseded|snapshot_manifest_unavailable|financial_snapshot_invalid|financial_snapshot_deal_mismatch/i.test(message) ? "stale_input"
    : /financial_input_required|preflight blocked|not ready|complete these forms|assumption validation/i.test(message) ? "needs_input"
    : /projections_review_blocked|institutional review|release blocked|acceptance failed|publication blocked/i.test(message) ? "review_blocked" : "transient";
  return { kind, retryable: kind === "transient", message };
}
