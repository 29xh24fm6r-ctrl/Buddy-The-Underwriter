export function resolveOwnerType(spreadType: string, metaOwnerType?: string): string {
  if (spreadType === "PERSONAL_INCOME" || spreadType === "PERSONAL_FINANCIAL_STATEMENT") {
    return "PERSONAL";
  }
  if (spreadType === "GLOBAL_CASH_FLOW") {
    return metaOwnerType ?? "GLOBAL";
  }
  return "DEAL";
}
