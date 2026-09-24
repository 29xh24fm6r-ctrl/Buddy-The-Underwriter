import "server-only";
import { redactForMarketplace, type SealedSnapshotInput, type KeyFactsSummary } from "./redactForMarketplace";
import { scanForPII, type PiiScanContext } from "./piiScanner";
import { forecastCoverage } from "@/lib/sba/forecastCoverage";

/** A lender handoff summarizes certified evidence, without another model rewriting its risk. */
export async function buildKFS(args: {
  snapshot: SealedSnapshotInput;
  piiContext: PiiScanContext;
}): Promise<KeyFactsSummary> {
  const kfs = redactForMarketplace(args.snapshot);
  const context = `The borrower operates in ${kfs.industryDescription} in ${kfs.state}, with ${kfs.yearsInBusinessBucket} operating history.`;
  // Free-text industry fields are not trusted to be anonymous. Financial facts
  // below contain no borrower names, contact details, or street-level locations.
  const safeContext = scanForPII(context, args.piiContext).hasPII ? "" : context;
  const coverage = kfs.forecastCoverage;
  const risk = coverage ? (() => {
    const base = forecastCoverage(coverage.base, coverage.threshold);
    const downside = forecastCoverage(coverage.downside, coverage.threshold);
    return `Base forecast DSCR — ${base.path}. Downside forecast DSCR — ${downside.path}. Coverage threshold: ${coverage.threshold.toFixed(2)}x. ` +
      (base.failures ? `Base below threshold: ${base.failures}. ` : "") +
      (downside.failures ? `Downside below threshold: ${downside.failures}. ` : "") +
      (downside.shortfalls ? `Downside cash flow does not cover debt service in ${downside.shortfalls}. ` : "") +
      (!base.complete || !downside.complete ? "Full forecast coverage is not established. " : "");
  })() : `Projected DSCR Year 1: ${kfs.dscrBaseProjected.toFixed(1)}x; downside Year 1: ${kfs.dscrStressProjected.toFixed(1)}x. Later-year coverage is not established. `;
  kfs.anonymizedNarrative = [
    `SBA ${kfs.sbaProgram} request for $${(kfs.loanAmount / 1000).toFixed(0)}K over ${kfs.termMonths} months.`,
    safeContext,
    `Borrower equity: ${kfs.equityInjectionPct.toFixed(1)}% of total project cost. Buddy SBA Score: ${kfs.score} (${kfs.band}). Feasibility: ${kfs.feasibilityScore}/100.`,
    risk,
    kfs.globalCashFlowDscr === null ? "Global cash-flow coverage is not established; supporting evidence remains required." : `Global cash-flow DSCR: ${kfs.globalCashFlowDscr.toFixed(1)}x.`,
    "This package is not a credit approval.",
  ].filter(Boolean).join(" ");
  return kfs;
}
