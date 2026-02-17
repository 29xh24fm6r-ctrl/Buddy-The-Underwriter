/**
 * Derive the canonical owner_type for a spread type.
 *
 * Spread type determines owner_type — meta is never used because the
 * enqueue path (no meta) and processor claim path (meta = "DEAL" default)
 * must resolve to the same value for CAS to succeed.
 */
export function resolveOwnerType(spreadType: string, _metaOwnerType?: string): string {
  if (spreadType === "PERSONAL_INCOME" || spreadType === "PERSONAL_FINANCIAL_STATEMENT") {
    return "PERSONAL";
  }
  if (spreadType === "GLOBAL_CASH_FLOW") {
    return "GLOBAL";
  }
  return "DEAL";
}
