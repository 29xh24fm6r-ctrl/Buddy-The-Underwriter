export type PackageRecoveryItem = { id: string; label: string; questionId?: string };

/** Only fixed, allowlisted text reaches the borrower. Never forward AI claims or internal errors. */
export function packageRecoveryItems(error: unknown, isTestDeal = false): PackageRecoveryItem[] {
  const text = typeof error === "string" ? error : "";
  const items: PackageRecoveryItem[] = [];
  if (text.includes("sources_and_uses_not_reconciled")) items.push({ id: "budget", questionId: "loan.use_of_proceeds",
    label: "Match your total project costs to the loan, your contribution, and any other funding. Include costs paid with your own funds, without counting any cost twice." });
  if (text.includes("feasibility_data_completeness_below_70_percent")) {
    items.push({ id: "feasibility", label: isTestDeal
      ? "This test application needs supporting market and location evidence. Public research is intentionally skipped for fictional test businesses; retrying unchanged test data will not fill those gaps."
      : "Buddy needs more supporting market and location evidence for the feasibility study. Review your business and proposed location details, then prepare again so Buddy can research the updated information. Saved answers alone do not verify market evidence." });
    if (/market_demand\.|location_suitability\./.test(text)) items.push({ id: "location", questionId: "B04",
      label: "Confirm the proposed operating location and trade area. If the site is not selected, describe the area you are considering; do not invent an address." });
    if (text.includes("accessAndVisibility")) items.push({ id: "site", questionId: "J07",
      label: "Add any known site access, visibility, zoning, or permitting information and supporting reports. Unknown details can remain unknown until verified." });
    if (text.includes("cashRunway")) items.push({ id: "cash", label:
      "The feasibility study needs a working-capital allocation and complete projected operating costs in a balanced project budget. Review these assumptions and your supporting documents; planned reserve coverage is not verified cash on hand." });
  }
  return items;
}

export function borrowerResearchWarning(warning: string): string {
  if (warning.startsWith("synthetic_qa_")) return "Test application: public research evidence is limited. Normal package quality checks still apply.";
  return "Business research needs additional supporting evidence before final completion.";
}
