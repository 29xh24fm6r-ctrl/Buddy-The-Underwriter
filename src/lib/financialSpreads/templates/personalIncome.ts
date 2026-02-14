import "server-only";

import type { SpreadTemplate } from "@/lib/financialSpreads/templates/templateTypes";
import type { FinancialFact, RenderedSpread, RenderedSpreadCellV2 } from "@/lib/financialSpreads/types";
import { factToCell, pickLatestFact } from "@/lib/financialSpreads/templateUtils";

type RowSpec = {
  key: string;
  label: string;
  section: string;
  factType: string;
  factKey: string;
  isFormula?: boolean;
};

const ROW_REGISTRY: RowSpec[] = [
  { key: "WAGES_W2", label: "W-2 Wages", section: "INCOME", factType: "PERSONAL_INCOME", factKey: "WAGES_W2" },
  { key: "SCHED_C_NET", label: "Schedule C Net Income", section: "INCOME", factType: "PERSONAL_INCOME", factKey: "SCHED_C_NET" },
  { key: "SCHED_E_NET", label: "Schedule E Net Income", section: "INCOME", factType: "PERSONAL_INCOME", factKey: "SCHED_E_NET" },
  { key: "K1_ORDINARY_INCOME", label: "K-1 Ordinary Income", section: "INCOME", factType: "PERSONAL_INCOME", factKey: "K1_ORDINARY_INCOME" },
  { key: "INTEREST_INCOME", label: "Interest Income", section: "INCOME", factType: "PERSONAL_INCOME", factKey: "INTEREST_INCOME" },
  { key: "DIVIDEND_INCOME", label: "Dividend Income", section: "INCOME", factType: "PERSONAL_INCOME", factKey: "DIVIDEND_INCOME" },
  { key: "CAPITAL_GAINS", label: "Capital Gains", section: "INCOME", factType: "PERSONAL_INCOME", factKey: "CAPITAL_GAINS" },
  { key: "SOCIAL_SECURITY", label: "Social Security", section: "INCOME", factType: "PERSONAL_INCOME", factKey: "SOCIAL_SECURITY" },
  { key: "OTHER_INCOME", label: "Other Income", section: "INCOME", factType: "PERSONAL_INCOME", factKey: "OTHER_INCOME" },
  { key: "TOTAL_PERSONAL_INCOME", label: "Total Personal Income", section: "TOTALS", factType: "PERSONAL_INCOME", factKey: "TOTAL_PERSONAL_INCOME", isFormula: true },
  { key: "ADJUSTED_GROSS_INCOME", label: "Adjusted Gross Income", section: "TOTALS", factType: "PERSONAL_INCOME", factKey: "ADJUSTED_GROSS_INCOME" },
];

const INCOME_KEYS = [
  "WAGES_W2", "SCHED_C_NET", "SCHED_E_NET", "K1_ORDINARY_INCOME",
  "INTEREST_INCOME", "DIVIDEND_INCOME", "CAPITAL_GAINS", "SOCIAL_SECURITY", "OTHER_INCOME",
];

function formatCurrency(v: number | null): string {
  if (v === null) return "";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function personalIncomeTemplate(): SpreadTemplate {
  return {
    spreadType: "PERSONAL_INCOME",
    title: "Personal Income",
    version: 1,
    priority: 30,
    prerequisites: () => ({
      facts: { fact_types: ["PERSONAL_INCOME"] },
      note: "Needs personal income facts",
    }),
    columns: ["Line Item", "Value"],
    render: (args): RenderedSpread => {
      const ownerId = args.ownerEntityId ?? null;

      // Filter to this owner's facts
      const ownerFacts = args.facts.filter(
        (f) => f.owner_type === "PERSONAL" && f.owner_entity_id === ownerId,
      );
      // Also use TAX_RETURN facts for this owner as fallback
      const taxFacts = args.facts.filter(
        (f) =>
          f.owner_type === "PERSONAL" &&
          f.owner_entity_id === ownerId &&
          f.fact_type === "TAX_RETURN",
      );
      const allPersonalFacts = [...ownerFacts, ...taxFacts];

      const cellByKey: Record<string, RenderedSpreadCellV2> = {};

      for (const spec of ROW_REGISTRY) {
        if (spec.isFormula) continue;
        const fact = pickLatestFact({
          facts: allPersonalFacts,
          factType: spec.factType,
          factKey: spec.factKey,
        });
        cellByKey[spec.key] = factToCell(fact);
      }

      // Compute TOTAL_PERSONAL_INCOME as sum of income components
      const existingTotal = pickLatestFact({
        facts: allPersonalFacts,
        factType: "PERSONAL_INCOME",
        factKey: "TOTAL_PERSONAL_INCOME",
      });

      if (existingTotal) {
        cellByKey["TOTAL_PERSONAL_INCOME"] = factToCell(existingTotal);
      } else {
        let sum = 0;
        let anyPresent = false;
        for (const k of INCOME_KEYS) {
          const v = cellByKey[k]?.value;
          if (typeof v === "number" && Number.isFinite(v)) {
            sum += v;
            anyPresent = true;
          }
        }
        cellByKey["TOTAL_PERSONAL_INCOME"] = {
          value: anyPresent ? sum : null,
          formula_ref: "SUM(income_components)",
        };
      }

      let asOf: string | null = null;
      for (const cell of Object.values(cellByKey)) {
        if (cell.as_of_date && (!asOf || cell.as_of_date > asOf)) {
          asOf = cell.as_of_date;
        }
      }

      const rows = ROW_REGISTRY.map((spec) => {
        const cell = cellByKey[spec.key] ?? { value: null };
        const display = typeof cell.value === "number" ? formatCurrency(cell.value) : "";
        return {
          key: spec.key,
          label: spec.label,
          section: spec.section,
          values: [{ ...cell, notes: display }] as RenderedSpreadCellV2[],
          formula: spec.isFormula ? "SUM(income_components)" : null,
        };
      });

      return {
        schema_version: 2,
        title: "Personal Income",
        spread_type: "PERSONAL_INCOME",
        status: "ready",
        generatedAt: new Date().toISOString(),
        asOf,
        columns: ["Line Item", "Value"],
        rows,
        meta: {
          template: "personal_income",
          version: 1,
          owner_entity_id: ownerId,
          row_registry: ROW_REGISTRY.map((r) => r.key),
        },
      };
    },
  };
}
