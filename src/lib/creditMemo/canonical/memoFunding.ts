import { buildSourcesAndUses } from "@/lib/sba/sbaSourcesAndUses";
import { buildUseOfProceeds } from "@/lib/sba/sbaForwardModelBuilder";
import type { CanonicalCreditMemoV1 } from "./types";
import type { SBAAssumptions } from "@/lib/sba/sbaReadinessTypes";

type Funding = CanonicalCreditMemoV1["sources_uses"];
type AssumptionsRow = { status: string; confirmed_at: string | null; loan_impact: SBAAssumptions["loanImpact"] };
type Proceeds = { category: string; description?: string | null; amount: number };

/** Reuse the package funding calculation; never infer equity from the gap. */
export function confirmedMemoFunding(row: AssumptionsRow | null, proceeds: Proceeds[]): Funding | null {
  if (!row || row.status !== "confirmed") return null;
  const impact = row.loan_impact;
  const validAmount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!impact || !validAmount(impact.loanAmount) || !validAmount(impact.equityInjectionAmount)) {
    throw new Error("Confirmed funding requires explicit loan and equity amounts.");
  }
  if (proceeds.some(p => !validAmount(p.amount)) ||
      !validAmount(impact.sellerFinancingAmount ?? 0) ||
      (impact.otherSources ?? []).some(s => !validAmount(s.amount))) {
    throw new Error("Confirmed funding contains an invalid amount.");
  }
  const result = buildSourcesAndUses({
    loanAmount: impact.loanAmount,
    equityInjectionAmount: impact.equityInjectionAmount,
    equityInjectionSource: impact.equityInjectionSource ?? "other",
    sellerFinancingAmount: impact.sellerFinancingAmount ?? 0,
    otherSources: impact.otherSources ?? [],
    useOfProceeds: buildUseOfProceeds(proceeds, impact.loanAmount),
    sellerNoteEquityPortion: 0,
    sellerNoteFullStandby: false,
  });
  const metric = (value: number | null) => ({ value, source: "Confirmed SBA assumptions and deal proceeds", updated_at: row.confirmed_at });
  return {
    total_project_cost: metric(proceeds.length ? result.totalUses : null),
    borrower_equity: metric(impact.equityInjectionAmount),
    borrower_equity_pct: metric(result.totalUses > 0 ? result.equityInjection.actualPct * 100 : null),
    bank_loan_total: metric(impact.loanAmount),
    sources: result.sources.map(s => ({ description: s.label, amount: metric(s.amount) })),
    uses: result.uses.map(u => ({ description: u.label, amount: metric(u.amount) })),
    equity_source_description: impact.equityInjectionSource?.replace(/_/g, " ") ?? "Source not supplied",
  };
}

/** Preserve explicit facts and reject conflicting confirmed inputs before AI calls. */
export function reconcileMemoFunding(existing: Funding, confirmed: Funding | null): Funding {
  if (!confirmed) return existing;
  const result = { ...confirmed };
  for (const key of ["total_project_cost", "borrower_equity", "borrower_equity_pct", "bank_loan_total"] as const) {
    const a = existing[key].value;
    const b = confirmed[key].value;
    if (a !== null && b !== null && Math.abs(a - b) > (key === "borrower_equity_pct" ? 0.01 : 1)) {
      throw new Error(`Funding conflict: ${key} is ${a} in financial facts and ${b} in confirmed assumptions/proceeds.`);
    }
    result[key] = a !== null ? existing[key] : confirmed[key];
  }
  if (!confirmed.uses.length) result.uses = existing.uses;
  return result;
}
