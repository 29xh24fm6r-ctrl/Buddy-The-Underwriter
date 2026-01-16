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

export function globalCashFlowTemplate(): SpreadTemplate {
  const title = "Global Cash Flow";

  return {
    spreadType: "GLOBAL_CASH_FLOW",
    title,
    version: 2,
    columns: ["Line Item", "Value"],
    render: (args): RenderedSpread => {
      const facts = args.facts;

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

      const asOf = maxIsoDate(
        cfaFact ? factAsOfDate(cfaFact) : null,
        maxIsoDate(adsFact ? factAsOfDate(adsFact) : null, adsStressedFact ? factAsOfDate(adsStressedFact) : null),
      );

      const excessComputed = computedCell({
        formula: "EXCESS_CASH_FLOW",
        inputs: {
          CASH_FLOW_AVAILABLE: toNumberCell(cfaCell),
          ANNUAL_DEBT_SERVICE: toNumberCell(adsCell),
        },
        as_of_date: asOfFromCells(cfaCell, adsCell),
      });

      const dscrComputed = computedCell({
        formula: "DSCR",
        inputs: {
          CASH_FLOW_AVAILABLE: toNumberCell(cfaCell),
          ANNUAL_DEBT_SERVICE: toNumberCell(adsCell),
        },
        as_of_date: asOfFromCells(cfaCell, adsCell),
      });

      const dscrStressedComputed = computedCell({
        formula: "DSCR_STRESSED_300BPS",
        inputs: {
          CASH_FLOW_AVAILABLE: toNumberCell(cfaCell),
          ANNUAL_DEBT_SERVICE_STRESSED_300BPS: toNumberCell(adsStressedCell),
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
          {
            key: "CASH_FLOW_AVAILABLE",
            label: "Cash Flow Available",
            values: [cfaCell],
          },
          {
            key: "ANNUAL_DEBT_SERVICE",
            label: "Annual Debt Service",
            values: [adsCell],
          },
          {
            key: "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
            label: "Annual Debt Service (Stressed +300 bps)",
            values: [adsStressedCell],
          },
          {
            key: "EXCESS_CASH_FLOW",
            label: "Excess Cash Flow",
            values: [preferFactOrComputed({ fact: excessFact, computed: excessComputed })],
          },
          {
            key: "DSCR",
            label: "DSCR",
            values: [preferFactOrComputed({ fact: dscrFact, computed: dscrComputed })],
          },
          {
            key: "DSCR_STRESSED_300BPS",
            label: "DSCR (Stressed +300 bps)",
            values: [preferFactOrComputed({ fact: dscrStressedFact, computed: dscrStressedComputed })],
          },
        ],
        meta: {
          template: "canonical_global_cash_flow",
          version: 2,
          row_registry: [
            "CASH_FLOW_AVAILABLE",
            "ANNUAL_DEBT_SERVICE",
            "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
            "EXCESS_CASH_FLOW",
            "DSCR",
            "DSCR_STRESSED_300BPS",
          ],
        },
      };
    },
  };
}
