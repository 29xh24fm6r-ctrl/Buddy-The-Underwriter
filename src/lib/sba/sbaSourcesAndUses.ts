// src/lib/sba/sbaSourcesAndUses.ts
// Phase BPG — Sources & Uses waterfall with equity injection validation.
// Pure function: no DB, no LLM, no I/O.
//
// Equity injection minimums (SOP 50 10 guidance):
//   - Existing business (change of ownership / expansion): 10%
//   - New business (startup): 20%

import type { UseOfProceedsLine } from "./sbaReadinessTypes";

export type EquityInjectionSource =
  | "cash_savings"
  | "401k_rollover"
  | "gift"
  | "other";

export interface SourceLine {
  label: string;
  amount: number;
  pctOfTotal: number;
  kind: "sba_loan" | "equity_injection" | "seller_financing" | "other";
}

export interface UseLine {
  label: string;
  amount: number;
  pctOfTotal: number;
  category: string;
}

export interface EquityInjectionCheck {
  required: boolean;
  minimumPct: number;
  actualPct: number;
  actualAmount: number;
  totalSourcesExcludingEquity: number;
  passes: boolean;
  shortfallAmount: number;
}

export interface SourcesAndUsesResult {
  sources: SourceLine[];
  uses: UseLine[];
  totalSources: number;
  totalUses: number;
  balanced: boolean;
  imbalance: number;
  equityInjection: EquityInjectionCheck;
}

export interface BuildSourcesAndUsesInput {
  loanAmount: number;
  equityInjectionAmount: number;
  equityInjectionSource: EquityInjectionSource;
  sellerFinancingAmount: number;
  otherSources: Array<{ description: string; amount: number }>;
  useOfProceeds: UseOfProceedsLine[];
  isNewBusiness: boolean;
}

function pct(part: number, whole: number): number {
  if (!Number.isFinite(whole) || whole === 0) return 0;
  return part / whole;
}

export function buildSourcesAndUses(
  input: BuildSourcesAndUsesInput,
): SourcesAndUsesResult {
  const {
    loanAmount,
    equityInjectionAmount,
    equityInjectionSource,
    sellerFinancingAmount,
    otherSources,
    useOfProceeds,
    isNewBusiness,
  } = input;

  const totalUses = useOfProceeds.reduce((sum, u) => sum + (u.amount || 0), 0);

  const otherSourcesTotal = otherSources.reduce(
    (sum, o) => sum + (o.amount || 0),
    0,
  );
  const totalSources =
    loanAmount + equityInjectionAmount + sellerFinancingAmount + otherSourcesTotal;

  const sources: SourceLine[] = [
    {
      label: "SBA Loan Proceeds",
      amount: loanAmount,
      pctOfTotal: pct(loanAmount, totalSources),
      kind: "sba_loan",
    },
  ];

  if (equityInjectionAmount > 0) {
    sources.push({
      label: `Equity Injection — ${equityInjectionSource.replace(/_/g, " ")}`,
      amount: equityInjectionAmount,
      pctOfTotal: pct(equityInjectionAmount, totalSources),
      kind: "equity_injection",
    });
  }

  if (sellerFinancingAmount > 0) {
    sources.push({
      label: "Seller Financing",
      amount: sellerFinancingAmount,
      pctOfTotal: pct(sellerFinancingAmount, totalSources),
      kind: "seller_financing",
    });
  }

  for (const other of otherSources) {
    if ((other.amount || 0) > 0) {
      sources.push({
        label: other.description || "Other Source",
        amount: other.amount,
        pctOfTotal: pct(other.amount, totalSources),
        kind: "other",
      });
    }
  }

  const uses: UseLine[] = useOfProceeds.map((u) => ({
    label: u.description || u.category,
    amount: u.amount,
    pctOfTotal: pct(u.amount, totalUses),
    category: u.category,
  }));

  // Equity injection minimum: 20% for new business, 10% for existing
  const minimumPct = isNewBusiness ? 0.2 : 0.1;
  const totalSourcesExcludingEquity = totalSources - equityInjectionAmount;
  const actualPct = pct(equityInjectionAmount, totalSources);
  const passes = actualPct >= minimumPct;
  const shortfallAmount = passes
    ? 0
    : Math.max(0, Math.round(minimumPct * totalSources - equityInjectionAmount));

  const imbalance = totalSources - totalUses;
  const balanced = Math.abs(imbalance) < 1; // within $1 rounding

  return {
    sources,
    uses,
    totalSources,
    totalUses,
    balanced,
    imbalance,
    equityInjection: {
      required: true,
      minimumPct,
      actualPct,
      actualAmount: equityInjectionAmount,
      totalSourcesExcludingEquity,
      passes,
      shortfallAmount,
    },
  };
}
