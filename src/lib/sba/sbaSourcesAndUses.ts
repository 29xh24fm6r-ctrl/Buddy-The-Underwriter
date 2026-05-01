// src/lib/sba/sbaSourcesAndUses.ts
// Phase BPG — Sources & Uses waterfall with equity injection validation.
// Pure function: no DB, no LLM, no I/O.
//
// Equity injection minimum (SOP 50 10 8):
//   10% of total project cost for both startups and complete changes of
//   ownership. The pre-2021 startup-vs-existing distinction (20% vs 10%)
//   was eliminated.
//
// Seller note rule (SOP 50 10 8 §B Ch.2):
//   A seller note may count toward the equity injection only if (a) it is
//   on full standby for the entire SBA loan term and (b) it does not exceed
//   50% of the equity injection.

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

export interface SellerNoteCheck {
  sellerNoteAmount: number;
  sellerNotePctOfEquity: number;
  fullStandbyConfirmed: boolean;
  passes: boolean;
  failureReason: string | null;
}

export interface EquityInjectionCheck {
  required: boolean;
  minimumPct: number;
  actualPct: number;
  actualAmount: number;
  totalSourcesExcludingEquity: number;
  passes: boolean;
  shortfallAmount: number;
  sellerNoteCheck: SellerNoteCheck;
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
  /**
   * Portion of the equity injection contributed by a seller note
   * (subset of equityInjectionAmount). Must be on full standby for the
   * SBA loan term and ≤ 50% of equity to be permitted.
   */
  sellerNoteEquityPortion: number;
  /**
   * True if the seller note (when used as equity) is on full standby for
   * the entire SBA loan term. Required when sellerNoteEquityPortion > 0.
   */
  sellerNoteFullStandby: boolean;
  /**
   * @deprecated SOP 50 10 8 sets a single 10% minimum. Retained for
   * backward compatibility with existing call sites; no longer affects
   * the minimum equity threshold.
   */
  isNewBusiness?: boolean;
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

  // SOP 50 10 8 sets equity injection minimum at 10% for both startups and
  // complete changes of ownership. Pre-2021 distinction (20% vs 10%) eliminated.
  const minimumPct = 0.10;
  const totalSourcesExcludingEquity = totalSources - equityInjectionAmount;
  const actualPct = pct(equityInjectionAmount, totalSources);
  const passesMinimum = actualPct >= minimumPct;
  const shortfallAmount = passesMinimum
    ? 0
    : Math.max(0, Math.round(minimumPct * totalSources - equityInjectionAmount));

  const sellerNoteAmount = Math.max(0, input.sellerNoteEquityPortion ?? 0);
  const sellerNotePctOfEquity =
    equityInjectionAmount > 0 ? sellerNoteAmount / equityInjectionAmount : 0;
  const sellerNoteWithinCap = sellerNotePctOfEquity <= 0.50;
  const sellerNoteStandbyOK =
    sellerNoteAmount === 0 || (input.sellerNoteFullStandby ?? false);
  const sellerNotePasses = sellerNoteWithinCap && sellerNoteStandbyOK;

  let sellerNoteFailureReason: string | null = null;
  if (!sellerNoteWithinCap) {
    sellerNoteFailureReason =
      `Seller note ($${sellerNoteAmount.toLocaleString()}) exceeds 50% of equity ` +
      `injection ($${equityInjectionAmount.toLocaleString()}).`;
  } else if (!sellerNoteStandbyOK) {
    sellerNoteFailureReason =
      `Seller note used as equity must be on full standby for the SBA loan term.`;
  }

  const sellerNoteCheck: SellerNoteCheck = {
    sellerNoteAmount,
    sellerNotePctOfEquity,
    fullStandbyConfirmed: input.sellerNoteFullStandby ?? false,
    passes: sellerNotePasses,
    failureReason: sellerNoteFailureReason,
  };

  const passesAll = passesMinimum && sellerNotePasses;

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
      passes: passesAll,
      shortfallAmount,
      sellerNoteCheck,
    },
  };
}
