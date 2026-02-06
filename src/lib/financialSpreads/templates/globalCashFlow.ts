import "server-only";

import type { SpreadTemplate } from "@/lib/financialSpreads/templates/templateTypes";
import type { FinancialFact, RenderedSpread, RenderedSpreadCellV2 } from "@/lib/financialSpreads/types";
import { computedCell } from "@/lib/financialSpreads/formulas";
import { factAsOfDate, factToCell, pickLatestFact } from "@/lib/financialSpreads/templateUtils";

function maxIsoDate(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function asOfFromCells(...cells: Array<RenderedSpreadCellV2 | null | undefined>): string | null {
  let out: string | null = null;
  for (const c of cells) {
    const d = c?.as_of_date ?? null;
    out = maxIsoDate(out, d);
  }
  return out;
}

function toNumberCell(cell: RenderedSpreadCellV2): number | null {
  const v = cell.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function preferFactOrComputed(args: {
  fact: FinancialFact | null;
  computed: RenderedSpreadCellV2;
}): RenderedSpreadCellV2 {
  if (args.fact) {
    return factToCell(args.fact);
  }
  return args.computed;
}

/**
 * Sum a specific fact_key across all PERSONAL-owned facts for a given fact_type.
 * Groups by owner_entity_id, picks latest per owner, then sums.
 */
function sumPersonalFacts(args: {
  facts: FinancialFact[];
  factType: string;
  factKey: string;
}): { value: number | null; asOf: string | null } {
  const byOwner = new Map<string | null, FinancialFact[]>();
  for (const f of args.facts) {
    if (f.owner_type !== "PERSONAL") continue;
    if (String(f.fact_type) !== args.factType) continue;
    if (String(f.fact_key) !== args.factKey) continue;
    const oid = f.owner_entity_id ?? null;
    if (!byOwner.has(oid)) byOwner.set(oid, []);
    byOwner.get(oid)!.push(f);
  }

  let total = 0;
  let anyPresent = false;
  let latestAsOf: string | null = null;

  for (const [, ownerFacts] of byOwner) {
    const best = pickLatestFact({ facts: ownerFacts, factType: args.factType, factKey: args.factKey });
    if (best && typeof best.fact_value_num === "number" && Number.isFinite(best.fact_value_num)) {
      total += best.fact_value_num;
      anyPresent = true;
      latestAsOf = maxIsoDate(latestAsOf, factAsOfDate(best));
    }
  }

  return { value: anyPresent ? total : null, asOf: latestAsOf };
}

function makeCell(value: number | null, asOf: string | null, formulaRef?: string): RenderedSpreadCellV2 {
  return {
    value,
    as_of_date: asOf,
    formula_ref: formulaRef ?? null,
  };
}

export function globalCashFlowTemplate(): SpreadTemplate {
  const title = "Global Cash Flow";

  return {
    spreadType: "GLOBAL_CASH_FLOW",
    title,
    version: 3,
    columns: ["Line Item", "Value"],
    render: (args): RenderedSpread => {
      const facts = args.facts;

      // ── DEAL-level property facts ──────────────────────────────────────────
      const cfaFact = pickLatestFact({
        facts,
        factType: "FINANCIAL_ANALYSIS",
        factKey: "CASH_FLOW_AVAILABLE",
      });
      const adsFact = pickLatestFact({
        facts,
        factType: "FINANCIAL_ANALYSIS",
        factKey: "ANNUAL_DEBT_SERVICE",
      });
      const adsStressedFact = pickLatestFact({
        facts,
        factType: "FINANCIAL_ANALYSIS",
        factKey: "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
      });
      const dscrFact = pickLatestFact({
        facts,
        factType: "FINANCIAL_ANALYSIS",
        factKey: "DSCR",
      });
      const dscrStressedFact = pickLatestFact({
        facts,
        factType: "FINANCIAL_ANALYSIS",
        factKey: "DSCR_STRESSED_300BPS",
      });
      const excessFact = pickLatestFact({
        facts,
        factType: "FINANCIAL_ANALYSIS",
        factKey: "EXCESS_CASH_FLOW",
      });

      const cfaCell = factToCell(cfaFact);
      const adsCell = factToCell(adsFact);
      const adsStressedCell = factToCell(adsStressedFact);

      // ── PERSONAL-level aggregation ─────────────────────────────────────────
      const personalIncome = sumPersonalFacts({
        facts,
        factType: "PERSONAL_INCOME",
        factKey: "TOTAL_PERSONAL_INCOME",
      });

      const personalDebtService = sumPersonalFacts({
        facts,
        factType: "PERSONAL_FINANCIAL_STATEMENT",
        factKey: "PFS_ANNUAL_DEBT_SERVICE",
      });

      const personalLiving = sumPersonalFacts({
        facts,
        factType: "PERSONAL_FINANCIAL_STATEMENT",
        factKey: "PFS_LIVING_EXPENSES",
      });

      // ── Computed rows ──────────────────────────────────────────────────────
      const propertyNoi = toNumberCell(cfaCell);
      const propertyDs = toNumberCell(adsCell);

      // Property Cash Flow = NOI - Property Debt Service
      const propertyCashFlow =
        propertyNoi !== null && propertyDs !== null ? propertyNoi - propertyDs : null;

      // Cash Available = Personal Income + Property Cash Flow
      const cashAvailable =
        personalIncome.value !== null || propertyCashFlow !== null
          ? (personalIncome.value ?? 0) + (propertyCashFlow ?? 0)
          : null;

      // Total Personal Obligations = Personal Debt Service + Living Expenses
      const totalObligations =
        personalDebtService.value !== null || personalLiving.value !== null
          ? (personalDebtService.value ?? 0) + (personalLiving.value ?? 0)
          : null;

      // Global Cash Flow = Cash Available - Total Obligations
      const gcfValue =
        cashAvailable !== null ? cashAvailable - (totalObligations ?? 0) : null;

      // GCF DSCR = Cash Available / (Property DS + Personal DS)
      const totalDs = (propertyDs ?? 0) + (personalDebtService.value ?? 0);
      const gcfDscr =
        cashAvailable !== null && totalDs > 0 ? cashAvailable / totalDs : null;

      // GCF DSCR Stressed
      const propertyDsStressed = toNumberCell(adsStressedCell);
      const totalDsStressed = (propertyDsStressed ?? 0) + (personalDebtService.value ?? 0);
      const gcfDscrStressed =
        cashAvailable !== null && totalDsStressed > 0 ? cashAvailable / totalDsStressed : null;

      // as_of
      const propAsOf = maxIsoDate(
        cfaFact ? factAsOfDate(cfaFact) : null,
        maxIsoDate(adsFact ? factAsOfDate(adsFact) : null, adsStressedFact ? factAsOfDate(adsStressedFact) : null),
      );
      const asOf = maxIsoDate(
        propAsOf,
        maxIsoDate(personalIncome.asOf, maxIsoDate(personalDebtService.asOf, personalLiving.asOf)),
      );

      // ── Legacy computed cells (property-only, for backward compat) ─────────
      const excessComputed = computedCell({
        formula: "EXCESS_CASH_FLOW",
        inputs: {
          CASH_FLOW_AVAILABLE: propertyNoi,
          ANNUAL_DEBT_SERVICE: propertyDs,
        },
        as_of_date: asOfFromCells(cfaCell, adsCell),
      });

      const dscrComputed = computedCell({
        formula: "DSCR",
        inputs: {
          CASH_FLOW_AVAILABLE: propertyNoi,
          ANNUAL_DEBT_SERVICE: propertyDs,
        },
        as_of_date: asOfFromCells(cfaCell, adsCell),
      });

      const dscrStressedComputed = computedCell({
        formula: "DSCR_STRESSED_300BPS",
        inputs: {
          CASH_FLOW_AVAILABLE: propertyNoi,
          ANNUAL_DEBT_SERVICE_STRESSED_300BPS: propertyDsStressed,
        },
        as_of_date: asOfFromCells(cfaCell, adsStressedCell),
      });

      return {
        schema_version: 2,
        title,
        spread_type: "GLOBAL_CASH_FLOW",
        status: "ready",
        generatedAt: new Date().toISOString(),
        asOf,
        columns: ["Line Item", "Value"],
        rows: [
          // ── Personal Income Section ────────────────────────────────────────
          {
            key: "GCF_PERSONAL_INCOME",
            label: "Total Personal Income",
            section: "PERSONAL",
            values: [makeCell(personalIncome.value, personalIncome.asOf, "SUM(personal_income)")],
          },
          // ── Property Section ───────────────────────────────────────────────
          {
            key: "CASH_FLOW_AVAILABLE",
            label: "Property NOI / Cash Flow Available",
            section: "PROPERTY",
            values: [cfaCell],
          },
          {
            key: "ANNUAL_DEBT_SERVICE",
            label: "Property Debt Service",
            section: "PROPERTY",
            values: [adsCell],
          },
          {
            key: "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
            label: "Property Debt Service (Stressed +300 bps)",
            section: "PROPERTY",
            values: [adsStressedCell],
          },
          {
            key: "GCF_PROPERTY_CASHFLOW",
            label: "Property Cash Flow (NOI - DS)",
            section: "PROPERTY",
            values: [makeCell(propertyCashFlow, propAsOf, "NOI - PROPERTY_DS")],
          },
          // ── Global Aggregation Section ─────────────────────────────────────
          {
            key: "GCF_CASH_AVAILABLE",
            label: "Cash Available (Personal + Property)",
            section: "GLOBAL",
            values: [makeCell(cashAvailable, asOf, "PERSONAL_INCOME + PROPERTY_CASHFLOW")],
          },
          {
            key: "GCF_PERSONAL_DEBT_SERVICE",
            label: "Personal Debt Service",
            section: "GLOBAL",
            values: [makeCell(personalDebtService.value, personalDebtService.asOf, "SUM(pfs_annual_debt_service)")],
          },
          {
            key: "GCF_PERSONAL_LIVING",
            label: "Personal Living Expenses",
            section: "GLOBAL",
            values: [makeCell(personalLiving.value, personalLiving.asOf, "SUM(pfs_living_expenses)")],
          },
          {
            key: "GCF_TOTAL_OBLIGATIONS",
            label: "Total Personal Obligations",
            section: "GLOBAL",
            values: [makeCell(totalObligations, maxIsoDate(personalDebtService.asOf, personalLiving.asOf), "PERSONAL_DS + LIVING_EXPENSES")],
          },
          {
            key: "GCF_GLOBAL_CASH_FLOW",
            label: "Global Cash Flow",
            section: "GLOBAL",
            values: [makeCell(gcfValue, asOf, "CASH_AVAILABLE - TOTAL_OBLIGATIONS")],
          },
          // ── DSCR Section ───────────────────────────────────────────────────
          {
            key: "EXCESS_CASH_FLOW",
            label: "Excess Cash Flow (Property)",
            section: "DSCR",
            values: [preferFactOrComputed({ fact: excessFact, computed: excessComputed })],
          },
          {
            key: "DSCR",
            label: "Property DSCR",
            section: "DSCR",
            values: [preferFactOrComputed({ fact: dscrFact, computed: dscrComputed })],
          },
          {
            key: "DSCR_STRESSED_300BPS",
            label: "Property DSCR (Stressed +300 bps)",
            section: "DSCR",
            values: [preferFactOrComputed({ fact: dscrStressedFact, computed: dscrStressedComputed })],
          },
          {
            key: "GCF_DSCR",
            label: "Global DSCR",
            section: "DSCR",
            values: [makeCell(gcfDscr, asOf, "CASH_AVAILABLE / TOTAL_DS")],
          },
          {
            key: "GCF_DSCR_STRESSED",
            label: "Global DSCR (Stressed +300 bps)",
            section: "DSCR",
            values: [makeCell(gcfDscrStressed, asOf, "CASH_AVAILABLE / TOTAL_DS_STRESSED")],
          },
        ],
        meta: {
          template: "canonical_global_cash_flow",
          version: 3,
          row_registry: [
            "GCF_PERSONAL_INCOME",
            "CASH_FLOW_AVAILABLE",
            "ANNUAL_DEBT_SERVICE",
            "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
            "GCF_PROPERTY_CASHFLOW",
            "GCF_CASH_AVAILABLE",
            "GCF_PERSONAL_DEBT_SERVICE",
            "GCF_PERSONAL_LIVING",
            "GCF_TOTAL_OBLIGATIONS",
            "GCF_GLOBAL_CASH_FLOW",
            "EXCESS_CASH_FLOW",
            "DSCR",
            "DSCR_STRESSED_300BPS",
            "GCF_DSCR",
            "GCF_DSCR_STRESSED",
          ],
        },
      };
    },
  };
}
