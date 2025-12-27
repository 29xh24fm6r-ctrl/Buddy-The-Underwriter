export function applyBankOverlay(bankId: string, facts: any) {
  // Example overlays (expand per bank)
  if (bankId === "CHASE") {
    if (facts.global_dscr < 1.25) {
      return { blocked: true, reason: "CHASE_DSCR_OVERLAY" };
    }
  }

  if (bankId === "LOCAL_SBA") {
    if (!facts.irs_transcript) {
      return { blocked: true, reason: "IRS_REQUIRED" };
    }
  }

  return { blocked: false };
}
