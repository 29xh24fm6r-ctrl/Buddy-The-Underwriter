/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 3: GLOBAL cash flow.
 *
 * Each entity is analyzed individually, then consolidated through a SINGLE
 * source-and-use ledger so owner distributions are counted exactly once.
 *
 * Single-count model (SBA global): the business side uses operating cash flow
 * (EBITDA, pre-distribution) less ALL business debt service; the personal side
 * uses guarantor EXTERNAL income (W-2, net rental, investment, other — NOT K-1
 * Box 1 ordinary income, NOT distributions) less personal debt service (incl.
 * all personal guarantees) less worst-of-three living expenses. Distributions
 * are an INTERNAL transfer (business cash → personal pocket): they already live
 * in business operating cash, so adding them to personal income would double-
 * count. The ledger records every transfer and asserts it nets to zero globally.
 *
 * Pure — no DB, no server-only.
 */

import {
  type EntityGraph,
  distributionsInto,
  intercompanyEliminations,
} from "@/lib/finengine/entityGraph";

export type NcadsProvenance = {
  nodeId: string;
  base: string; // e.g. 'EBITDA' | 'NCADS'
  components: Record<string, number>;
  note: string;
};

export type BusinessEntityCashFlow = {
  nodeId: string;
  /** Operating cash flow (EBITDA / NCADS), measured PRE-distribution. */
  operatingCashFlow: number;
  /** All business debt service (P&I) for this entity, incl. the proposed loan. */
  businessDebtService: number;
  ownershipPctByGuarantor?: Record<string, number>;
  ncadsProvenance: NcadsProvenance;
};

export type PersonalIncomeComponents = {
  wages: number; // W-2
  netRental: number; // Schedule E net rental
  investment: number; // dividends/interest
  other: number;
  // NOTE: there is intentionally NO `distributions` and NO `k1Ordinary` field —
  // distributions are captured on the business side; K-1 Box 1 is never income.
};

export type LivingExpenseInputs = {
  stated?: number | null;
  fromHousing?: number | null; // derived from PFS housing payment
  sbaMinimum?: number | null; // SOP living-expense minimum
};

export type PersonalGuarantorCashFlow = {
  nodeId: string;
  income: PersonalIncomeComponents;
  personalDebtService: number; // incl. ALL personal guarantees as real debt service
  livingExpenses: LivingExpenseInputs;
};

/** Worst-of-three living expenses — the most conservative (highest) estimate. */
export function worstOfThreeLivingExpenses(li: LivingExpenseInputs): { value: number; basis: string } {
  const candidates: Array<[string, number]> = [];
  if (li.stated != null) candidates.push(["stated", li.stated]);
  if (li.fromHousing != null) candidates.push(["from_housing", li.fromHousing]);
  if (li.sbaMinimum != null) candidates.push(["sba_minimum", li.sbaMinimum]);
  if (candidates.length === 0) return { value: 0, basis: "none_available" };
  const worst = candidates.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { value: worst[1], basis: worst[0] };
}

function sumIncome(c: PersonalIncomeComponents): number {
  return c.wages + c.netRental + c.investment + c.other;
}

export type GlobalCashFlowResult = {
  globalCashBeforeDebt: number;
  globalDebtService: number;
  globalDSCR: number | null;
  businessOperating: number;
  personalContribution: number;
  totalLivingExpenses: number;
  intercompanyEliminated: number;
  /** Source-and-use ledger of internal transfers (distributions). */
  ledger: Array<{ kind: string; node: string; amount: number; effect: "internal_transfer" }>;
  /** True when every distribution nets to zero globally (single-count proof). */
  singleCountVerified: boolean;
  ncadsProvenance: NcadsProvenance[];
  warnings: string[];
};

/**
 * Consolidate the graph into a true global cash flow. Distributions are recorded
 * in the ledger as internal transfers and excluded from both sides (single-count).
 */
export function computeGlobalCashFlow(
  graph: EntityGraph,
  business: BusinessEntityCashFlow[],
  personal: PersonalGuarantorCashFlow[],
): GlobalCashFlowResult {
  const warnings: string[] = [];

  const businessOperating = business.reduce((s, b) => s + b.operatingCashFlow, 0);
  const businessDebt = business.reduce((s, b) => s + b.businessDebtService, 0);
  const intercompany = intercompanyEliminations(graph);

  let personalIncome = 0;
  let personalDebt = 0;
  let totalLiving = 0;
  for (const p of personal) {
    personalIncome += sumIncome(p.income);
    personalDebt += p.personalDebtService;
    totalLiving += worstOfThreeLivingExpenses(p.livingExpenses).value;
  }

  // Source-and-use ledger: every actual distribution is an internal transfer.
  const ledger: GlobalCashFlowResult["ledger"] = [];
  let distributionsIntoPersonal = 0;
  for (const p of personal) {
    const d = distributionsInto(graph, p.nodeId);
    if (d !== 0) {
      ledger.push({ kind: "distribution", node: p.nodeId, amount: d, effect: "internal_transfer" });
      distributionsIntoPersonal += d;
    }
  }
  const distributionsOutOfBusiness = graph.edges
    .filter((e) => e.type === "distribution")
    .reduce((s, e) => s + (e.amount ?? 0), 0);
  // Single-count proof: distributions leaving the business must equal those
  // arriving at personal nodes — they net to zero globally and are excluded.
  const singleCountVerified = Math.abs(distributionsOutOfBusiness - distributionsIntoPersonal) < 0.01;
  if (!singleCountVerified) {
    warnings.push("Distribution source/use mismatch — global cash flow may be double-counting owner draws.");
  }

  // Related-party rent/fees are intercompany: subtract once to avoid inflating
  // global cash with money that is simultaneously another node's expense.
  const businessOperatingNet = businessOperating - intercompany;

  const personalContribution = personalIncome - totalLiving; // before personal debt
  const globalCashBeforeDebt = businessOperatingNet + personalContribution;
  const globalDebtService = businessDebt + personalDebt;
  const globalDSCR = globalDebtService > 0 ? globalCashBeforeDebt / globalDebtService : null;

  return {
    globalCashBeforeDebt,
    globalDebtService,
    globalDSCR,
    businessOperating: businessOperatingNet,
    personalContribution,
    totalLivingExpenses: totalLiving,
    intercompanyEliminated: intercompany,
    ledger,
    singleCountVerified,
    ncadsProvenance: business.map((b) => b.ncadsProvenance),
    warnings,
  };
}
