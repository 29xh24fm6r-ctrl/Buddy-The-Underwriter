export function applyBankOverlays(bankId: string, facts: any) {
  const violations = [];

  if (bankId === "LOCAL_SBA") {
    if (facts.global_dscr < 1.15) {
      violations.push({
        rule: "LOCAL_SBA_DSCR",
        required: ">= 1.15"
      });
    }
  }

  return violations;
}
