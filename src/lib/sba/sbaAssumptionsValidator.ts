import type { SBAAssumptions, PreflightResult } from "./sbaReadinessTypes";

export function validateSBAAssumptions(a: SBAAssumptions): PreflightResult {
  const blockers: string[] = [];

  if (!a.revenueStreams?.length)
    blockers.push("At least one revenue stream is required");

  for (const s of a.revenueStreams ?? []) {
    if (!s.name) blockers.push("All revenue streams must have a name");
    if ((s.baseAnnualRevenue ?? 0) <= 0)
      blockers.push(
        `Revenue stream "${s.name}": base revenue must be > 0`,
      );
    if (s.growthRateYear1 < -0.5 || s.growthRateYear1 > 2)
      blockers.push(
        `Revenue stream "${s.name}": Y1 growth rate out of range (−50% to +200%)`,
      );
  }

  if (
    a.costAssumptions?.cogsPercentYear1 === undefined ||
    a.costAssumptions?.cogsPercentYear1 === null
  )
    blockers.push("COGS % required for Year 1");
  if (
    a.costAssumptions?.cogsPercentYear2 === undefined ||
    a.costAssumptions?.cogsPercentYear2 === null
  )
    blockers.push("COGS % required for Year 2");
  if (
    a.costAssumptions?.cogsPercentYear3 === undefined ||
    a.costAssumptions?.cogsPercentYear3 === null
  )
    blockers.push("COGS % required for Year 3");

  if (!a.loanImpact?.loanAmount || a.loanImpact.loanAmount <= 0)
    blockers.push("Loan amount is required");
  if (!a.loanImpact?.termMonths || a.loanImpact.termMonths <= 0)
    blockers.push("Loan term (months) is required");
  if (!a.loanImpact?.interestRate || a.loanImpact.interestRate <= 0)
    blockers.push("Interest rate is required");

  if (!a.managementTeam?.length)
    blockers.push("At least one management team member is required");
  for (const m of a.managementTeam ?? []) {
    if (!m.name) blockers.push("All management members must have a name");
    if (!m.bio || m.bio.length < 20)
      blockers.push(`"${m.name}": bio must be at least 20 characters`);
  }

  return blockers.length === 0 ? { ok: true } : { ok: false, blockers };
}

export function computeAssumptionsCompletionPct(
  a: Partial<SBAAssumptions>,
): number {
  let filled = 0;
  const total = 5;
  if ((a.revenueStreams?.length ?? 0) > 0) filled++;
  if (a.costAssumptions?.cogsPercentYear1 !== undefined) filled++;
  if ((a.loanImpact?.loanAmount ?? 0) > 0) filled++;
  if ((a.workingCapital?.targetDSO ?? 0) > 0) filled++;
  if ((a.managementTeam?.length ?? 0) > 0) filled++;
  return Math.round((filled / total) * 100);
}
