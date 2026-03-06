/**
 * Consolidation Engine — God Tier Phase 2C, Section 3
 *
 * 6-step consolidation methodology:
 *   Step 1: Align fiscal years
 *   Step 2: Standardize accounting basis
 *   Step 3: Aggregate all line items
 *   Step 4: Eliminate intercompany transactions
 *   Step 5: Minority interest adjustment
 *   Step 6: Produce consolidated financial statements
 *
 * Balance sheet invariant: cons_assets = cons_liabilities + cons_equity
 * HARD ERROR if this fails — never surface a broken consolidation.
 *
 * Pure function — no DB, no server imports.
 */

import type { ConsolidationMethod, EntityRelationship } from "./entityMap";
import type { IntercompanyTransaction } from "./intercompanyDetection";

// ---------------------------------------------------------------------------
// Types — Input
// ---------------------------------------------------------------------------

export type EntityFinancials = {
  entityId: string;
  entityName: string;
  taxYear: number;
  fiscalYearEnd: string | null; // MM-DD
  accountingBasis: "cash" | "accrual" | "tax_basis" | "unknown";
  // Income statement
  revenue: number | null;
  cogs: number | null;
  grossProfit: number | null;
  operatingExpenses: number | null;
  interestExpense: number | null;
  depreciation: number | null;
  amortization: number | null;
  netIncome: number | null;
  ebitda: number | null;
  // Balance sheet
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  totalFundedDebt: number | null;
  // Cash flow
  annualDebtService: number | null;
  ncads: number | null;
};

export type ConsolidationInput = {
  entities: EntityFinancials[];
  relationships: EntityRelationship[];
  intercompanyTransactions: IntercompanyTransaction[];
  consolidationMethod: ConsolidationMethod;
  consolidationYear: number;
};

// ---------------------------------------------------------------------------
// Types — Output
// ---------------------------------------------------------------------------

export type EliminationEntry = {
  transactionId: string;
  transactionType: string;
  debitEntityId: string;
  debitLine: string;
  debitAmount: number;
  creditEntityId: string;
  creditLine: string;
  creditAmount: number;
};

export type MinorityInterest = {
  entityId: string;
  entityName: string;
  minorityPct: number;
  minorityInterestEquity: number;
  minorityInterestIncome: number;
};

export type ConsolidationFlag = {
  severity: "critical" | "elevated" | "info";
  code: string;
  description: string;
  entityIds: string[];
};

export type FiscalYearAlignment = {
  entityId: string;
  taxYearUsed: number;
  fiscalYearEnd: string | null;
  offsetMonths: number;
  flag: boolean;
};

export type ConsolidatedFinancials = {
  // Income statement
  consRevenue: number;
  consCogs: number;
  consGrossProfit: number;
  consOperatingExpenses: number;
  consInterestExpense: number;
  consDepreciation: number;
  consAmortization: number;
  consNetIncome: number;
  consEbitda: number;
  // Balance sheet
  consTotalAssets: number;
  consTotalLiabilities: number;
  consTotalEquity: number;
  consTotalFundedDebt: number;
  // Cash flow
  consAnnualDebtService: number;
  consNcads: number;
  consDscr: number | null;
};

export type ConsolidationResult = {
  ok: boolean;
  error?: string;
  consolidatedFinancials: ConsolidatedFinancials | null;
  eliminations: EliminationEntry[];
  minorityInterests: MinorityInterest[];
  fiscalYearAlignments: FiscalYearAlignment[];
  flags: ConsolidationFlag[];
  totalRevenueEliminated: number;
  totalExpenseEliminated: number;
  totalLoansEliminated: number;
  balanceSheetBalanced: boolean;
  confidence: "high" | "medium" | "low";
  entityCount: number;
  consolidationMethod: ConsolidationMethod;
};

// ---------------------------------------------------------------------------
// Balance sheet tolerance
// ---------------------------------------------------------------------------

const BS_BALANCE_TOLERANCE = 1; // $1 rounding tolerance

// ---------------------------------------------------------------------------
// Main consolidation function
// ---------------------------------------------------------------------------

export function runConsolidation(input: ConsolidationInput): ConsolidationResult {
  const flags: ConsolidationFlag[] = [];
  const eliminations: EliminationEntry[] = [];
  const minorityInterests: MinorityInterest[] = [];

  if (input.entities.length === 0) {
    return emptyResult("No entities provided", input.consolidationMethod);
  }

  // ----- Step 1: Align fiscal years -----
  const alignments = alignFiscalYears(input.entities, input.consolidationYear);
  for (const a of alignments) {
    if (a.flag) {
      flags.push({
        severity: "elevated",
        code: "FISCAL_YEAR_MISMATCH",
        description: `Entity ${a.entityId} has ${a.offsetMonths}-month offset from consolidation year`,
        entityIds: [a.entityId],
      });
    }
  }

  // ----- Step 2: Standardize accounting basis -----
  const bases = new Set(input.entities.map((e) => e.accountingBasis));
  if (bases.size > 1 && !bases.has("unknown")) {
    flags.push({
      severity: "elevated",
      code: "ACCOUNTING_BASIS_MISMATCH",
      description: `Mixed accounting bases: ${[...bases].join(", ")}`,
      entityIds: input.entities.map((e) => e.entityId),
    });
  }

  // ----- Step 3: Aggregate all line items -----
  const aggregated = aggregateFinancials(input.entities);

  // ----- Step 4: Eliminate intercompany transactions -----
  let totalRevenueEliminated = 0;
  let totalExpenseEliminated = 0;
  let totalLoansEliminated = 0;

  for (const ic of input.intercompanyTransactions) {
    if (!ic.eliminationRequired) continue;

    const entry: EliminationEntry = {
      transactionId: ic.transactionId,
      transactionType: ic.transactionType,
      debitEntityId: ic.receivingEntityId,
      debitLine: ic.receivingLineItem,
      debitAmount: ic.annualAmount,
      creditEntityId: ic.payingEntityId,
      creditLine: ic.payingLineItem,
      creditAmount: ic.annualAmount,
    };
    eliminations.push(entry);

    if (ic.transactionType === "loan") {
      // Loans: reduce both assets (receivable) and liabilities (payable)
      aggregated.totalAssets -= ic.annualAmount;
      aggregated.totalLiabilities -= ic.annualAmount;
      aggregated.totalFundedDebt -= ic.annualAmount;
      totalLoansEliminated += ic.annualAmount;
    } else if (ic.transactionType === "interest") {
      // Interest: reduce both interest income (revenue) and interest expense
      aggregated.revenue -= ic.annualAmount;
      aggregated.interestExpense -= ic.annualAmount;
      totalRevenueEliminated += ic.annualAmount;
      totalExpenseEliminated += ic.annualAmount;
    } else {
      // Revenue/expense eliminations (rent, mgmt fee, royalties, services, goods)
      aggregated.revenue -= ic.annualAmount;
      aggregated.operatingExpenses -= ic.annualAmount;
      totalRevenueEliminated += ic.annualAmount;
      totalExpenseEliminated += ic.annualAmount;
    }

    // Flag high elimination ratios
    const receivingEntity = input.entities.find((e) => e.entityId === ic.receivingEntityId);
    if (receivingEntity && receivingEntity.revenue && receivingEntity.revenue > 0) {
      if (ic.annualAmount / receivingEntity.revenue > 0.3) {
        flags.push({
          severity: "elevated",
          code: "HIGH_ELIMINATION_RATIO",
          description: `Elimination of $${ic.annualAmount.toLocaleString()} is >${(ic.annualAmount / receivingEntity.revenue * 100).toFixed(0)}% of ${receivingEntity.entityName}'s revenue`,
          entityIds: [ic.receivingEntityId],
        });
      }
    }
  }

  // Recompute derived lines
  aggregated.grossProfit = aggregated.revenue - aggregated.cogs;
  aggregated.netIncome = aggregated.grossProfit - aggregated.operatingExpenses - aggregated.interestExpense;
  aggregated.ebitda = aggregated.netIncome + aggregated.interestExpense + aggregated.depreciation + aggregated.amortization;
  aggregated.ncads = aggregated.ebitda - aggregated.annualDebtService;

  // ----- Step 5: Minority interest adjustment -----
  for (const rel of input.relationships) {
    if (rel.relationshipType === "parent_subsidiary" && rel.ownershipPct < 100) {
      const entity = input.entities.find((e) => e.entityId === rel.childEntityId);
      if (entity) {
        const minorityPct = (100 - rel.ownershipPct) / 100;
        const miEquity = (entity.totalEquity ?? 0) * minorityPct;
        const miIncome = (entity.netIncome ?? 0) * minorityPct;

        minorityInterests.push({
          entityId: entity.entityId,
          entityName: entity.entityName,
          minorityPct: minorityPct * 100,
          minorityInterestEquity: miEquity,
          minorityInterestIncome: miIncome,
        });

        // MI tracked as memo in minorityInterests array.
        // Do NOT deduct from aggregated totals — that would break the
        // balance sheet invariant (cons_assets = cons_liabilities + cons_equity).
        // Controlling interest equity = consEquity - sum(miEquity).

        flags.push({
          severity: "info",
          code: "MINORITY_INTEREST",
          description: `${(minorityPct * 100).toFixed(0)}% minority interest in ${entity.entityName}`,
          entityIds: [entity.entityId],
        });
      }
    }
  }

  // ----- Step 6: Balance sheet invariant check (HARD ERROR) -----
  const bsDiff = Math.abs(aggregated.totalAssets - (aggregated.totalLiabilities + aggregated.totalEquity));
  const balanceSheetBalanced = bsDiff <= BS_BALANCE_TOLERANCE;

  if (!balanceSheetBalanced) {
    return {
      ok: false,
      error: `BALANCE SHEET INVARIANT FAILED: cons_assets ($${aggregated.totalAssets.toLocaleString()}) ≠ cons_liabilities ($${aggregated.totalLiabilities.toLocaleString()}) + cons_equity ($${aggregated.totalEquity.toLocaleString()}). Difference: $${bsDiff.toLocaleString()}`,
      consolidatedFinancials: null,
      eliminations,
      minorityInterests,
      fiscalYearAlignments: alignments,
      flags: [...flags, {
        severity: "critical",
        code: "BS_INVARIANT_FAIL",
        description: `Balance sheet does not balance after consolidation. Difference: $${bsDiff.toLocaleString()}`,
        entityIds: input.entities.map((e) => e.entityId),
      }],
      totalRevenueEliminated,
      totalExpenseEliminated,
      totalLoansEliminated,
      balanceSheetBalanced: false,
      confidence: "low",
      entityCount: input.entities.length,
      consolidationMethod: input.consolidationMethod,
    };
  }

  // ----- DSCR -----
  const consDscr = aggregated.annualDebtService > 0
    ? aggregated.ncads / aggregated.annualDebtService
    : null;

  // ----- Confidence -----
  const confidence = determineConfidence(flags, input.intercompanyTransactions);

  const consolidatedFinancials: ConsolidatedFinancials = {
    consRevenue: aggregated.revenue,
    consCogs: aggregated.cogs,
    consGrossProfit: aggregated.grossProfit,
    consOperatingExpenses: aggregated.operatingExpenses,
    consInterestExpense: aggregated.interestExpense,
    consDepreciation: aggregated.depreciation,
    consAmortization: aggregated.amortization,
    consNetIncome: aggregated.netIncome,
    consEbitda: aggregated.ebitda,
    consTotalAssets: aggregated.totalAssets,
    consTotalLiabilities: aggregated.totalLiabilities,
    consTotalEquity: aggregated.totalEquity,
    consTotalFundedDebt: aggregated.totalFundedDebt,
    consAnnualDebtService: aggregated.annualDebtService,
    consNcads: aggregated.ncads,
    consDscr,
  };

  return {
    ok: true,
    consolidatedFinancials,
    eliminations,
    minorityInterests,
    fiscalYearAlignments: alignments,
    flags,
    totalRevenueEliminated,
    totalExpenseEliminated,
    totalLoansEliminated,
    balanceSheetBalanced: true,
    confidence,
    entityCount: input.entities.length,
    consolidationMethod: input.consolidationMethod,
  };
}

// ---------------------------------------------------------------------------
// Step 1: Fiscal year alignment
// ---------------------------------------------------------------------------

function alignFiscalYears(
  entities: EntityFinancials[], consolidationYear: number,
): FiscalYearAlignment[] {
  return entities.map((e) => {
    const fyEnd = e.fiscalYearEnd;
    let offsetMonths = 0;

    if (fyEnd && fyEnd !== "12-31") {
      const [mm] = fyEnd.split("-").map(Number);
      offsetMonths = mm <= 6 ? 12 - mm : mm - 12;
      if (offsetMonths < 0) offsetMonths = Math.abs(offsetMonths);
    }

    return {
      entityId: e.entityId,
      taxYearUsed: e.taxYear,
      fiscalYearEnd: fyEnd,
      offsetMonths,
      flag: offsetMonths > 6,
    };
  });
}

// ---------------------------------------------------------------------------
// Step 3: Aggregate financials
// ---------------------------------------------------------------------------

type AggregatedLine = {
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  interestExpense: number;
  depreciation: number;
  amortization: number;
  netIncome: number;
  ebitda: number;
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalFundedDebt: number;
  annualDebtService: number;
  ncads: number;
};

function aggregateFinancials(entities: EntityFinancials[]): AggregatedLine {
  const agg: AggregatedLine = {
    revenue: 0, cogs: 0, grossProfit: 0, operatingExpenses: 0,
    interestExpense: 0, depreciation: 0, amortization: 0,
    netIncome: 0, ebitda: 0,
    totalAssets: 0, totalLiabilities: 0, totalEquity: 0,
    totalFundedDebt: 0, annualDebtService: 0, ncads: 0,
  };

  for (const e of entities) {
    agg.revenue += e.revenue ?? 0;
    agg.cogs += e.cogs ?? 0;
    agg.grossProfit += e.grossProfit ?? 0;
    agg.operatingExpenses += e.operatingExpenses ?? 0;
    agg.interestExpense += e.interestExpense ?? 0;
    agg.depreciation += e.depreciation ?? 0;
    agg.amortization += e.amortization ?? 0;
    agg.netIncome += e.netIncome ?? 0;
    agg.ebitda += e.ebitda ?? 0;
    agg.totalAssets += e.totalAssets ?? 0;
    agg.totalLiabilities += e.totalLiabilities ?? 0;
    agg.totalEquity += e.totalEquity ?? 0;
    agg.totalFundedDebt += e.totalFundedDebt ?? 0;
    agg.annualDebtService += e.annualDebtService ?? 0;
    agg.ncads += e.ncads ?? 0;
  }

  return agg;
}

// ---------------------------------------------------------------------------
// Confidence determination
// ---------------------------------------------------------------------------

function determineConfidence(
  flags: ConsolidationFlag[],
  transactions: IntercompanyTransaction[],
): "high" | "medium" | "low" {
  if (flags.some((f) => f.severity === "critical")) return "low";

  const unconfirmedCount = transactions.filter(
    (t) => t.eliminationRequired && !t.bankerConfirmed,
  ).length;

  if (unconfirmedCount > 0) return "medium";
  if (flags.some((f) => f.severity === "elevated")) return "medium";

  return "high";
}

// ---------------------------------------------------------------------------
// Empty result helper
// ---------------------------------------------------------------------------

function emptyResult(error: string, method: ConsolidationMethod): ConsolidationResult {
  return {
    ok: false,
    error,
    consolidatedFinancials: null,
    eliminations: [],
    minorityInterests: [],
    fiscalYearAlignments: [],
    flags: [],
    totalRevenueEliminated: 0,
    totalExpenseEliminated: 0,
    totalLoansEliminated: 0,
    balanceSheetBalanced: true,
    confidence: "low",
    entityCount: 0,
    consolidationMethod: method,
  };
}
