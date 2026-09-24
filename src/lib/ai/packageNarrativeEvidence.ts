import type { SensitivityScenario, SourcesAndUsesResult } from "@/lib/sba/sbaReadinessTypes";

const dollars = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Textual anchors copy the saved model; no second financial calculation. */
export function fundingScheduleText(schedule: Pick<SourcesAndUsesResult, "sources" | "uses" | "totalSources" | "totalUses">): string {
  const lines = (rows: { label: string; amount: number }[]) => rows.filter(row => row.amount !== 0)
    .map(row => `${row.label}: ${dollars(row.amount)}`).join("; ");
  return `Sources: ${lines(schedule.sources)}. Total sources: ${dollars(schedule.totalSources)}. Uses: ${lines(schedule.uses)}. Total uses: ${dollars(schedule.totalUses)}.`;
}

export function downsideDisclosure(scenarios: SensitivityScenario[] | undefined): string | null {
  const downside = scenarios?.find(s => s.name === "downside");
  if (!downside || downside.passesSBAThreshold !== false) return null;
  const values = [downside.dscrYear1, downside.dscrYear2, downside.dscrYear3];
  if (!values.every(v => typeof v === "number" && Number.isFinite(v))) return null;
  return `Downside DSCR: Year 1 ${values[0]!.toFixed(2)}x, Year 2 ${values[1]!.toFixed(2)}x, Year 3 ${values[2]!.toFixed(2)}x. The saved downside scenario fails the model's coverage threshold; base-case strength does not eliminate this repayment risk.`;
}

export const BASE_CASE_LIMITATION = "Base-case DSCR and break-even margin of safety are conditional model results, not proof of startup ramp resilience or downside repayment capacity. Do not present unmodeled mitigations as restoring coverage.";

export function projectionSummaryText(year: { ebitda: number; totalDebtService: number; dscr: number | null } | undefined, threshold: number, scenarios: SensitivityScenario[]): string {
  const dscr = year?.dscr;
  const base = typeof dscr === "number" && Number.isFinite(dscr)
    ? `Year 1 projected EBITDA is ${dollars(year!.ebitda)} against ${dollars(year!.totalDebtService)} in total annual debt service. Base-case DSCR of ${dscr.toFixed(2)}x ${dscr >= threshold ? "meets" : "falls below"} the model's ${threshold.toFixed(2)}x coverage threshold.`
    : "Year 1 projected coverage is not determined.";
  return [base, downsideDisclosure(scenarios), "These are conditional projections, not historical performance or a lender approval."].filter(Boolean).join(" ");
}
