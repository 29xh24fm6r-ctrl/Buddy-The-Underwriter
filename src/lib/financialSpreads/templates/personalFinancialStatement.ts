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
  // ASSETS
  { key: "PFS_CASH", label: "Cash & Savings", section: "ASSETS", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_CASH" },
  { key: "PFS_SECURITIES", label: "Stocks, Bonds & Securities", section: "ASSETS", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_SECURITIES" },
  { key: "PFS_REAL_ESTATE", label: "Real Estate (Market Value)", section: "ASSETS", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_REAL_ESTATE" },
  { key: "PFS_BUSINESS_INTERESTS", label: "Business Interests", section: "ASSETS", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_BUSINESS_INTERESTS" },
  { key: "PFS_RETIREMENT", label: "Retirement Accounts", section: "ASSETS", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_RETIREMENT" },
  { key: "PFS_OTHER_ASSETS", label: "Other Assets", section: "ASSETS", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_OTHER_ASSETS" },
  { key: "PFS_TOTAL_ASSETS", label: "Total Assets", section: "ASSETS", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_TOTAL_ASSETS", isFormula: true },

  // LIABILITIES
  { key: "PFS_MORTGAGES", label: "Mortgages", section: "LIABILITIES", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_MORTGAGES" },
  { key: "PFS_INSTALLMENT_DEBT", label: "Installment Debt", section: "LIABILITIES", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_INSTALLMENT_DEBT" },
  { key: "PFS_CREDIT_CARDS", label: "Credit Card Balances", section: "LIABILITIES", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_CREDIT_CARDS" },
  { key: "PFS_CONTINGENT", label: "Contingent Liabilities", section: "LIABILITIES", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_CONTINGENT" },
  { key: "PFS_OTHER_LIABILITIES", label: "Other Liabilities", section: "LIABILITIES", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_OTHER_LIABILITIES" },
  { key: "PFS_TOTAL_LIABILITIES", label: "Total Liabilities", section: "LIABILITIES", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_TOTAL_LIABILITIES", isFormula: true },

  // EQUITY
  { key: "PFS_NET_WORTH", label: "Net Worth", section: "EQUITY", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_NET_WORTH", isFormula: true },

  // ANNUAL OBLIGATIONS (critical for GCF)
  { key: "PFS_ANNUAL_DEBT_SERVICE", label: "Annual Debt Service", section: "OBLIGATIONS", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_ANNUAL_DEBT_SERVICE" },
  { key: "PFS_LIVING_EXPENSES", label: "Annual Living Expenses", section: "OBLIGATIONS", factType: "PERSONAL_FINANCIAL_STATEMENT", factKey: "PFS_LIVING_EXPENSES" },
];

const ASSET_KEYS = [
  "PFS_CASH", "PFS_SECURITIES", "PFS_REAL_ESTATE", "PFS_BUSINESS_INTERESTS",
  "PFS_RETIREMENT", "PFS_OTHER_ASSETS",
];

const LIABILITY_KEYS = [
  "PFS_MORTGAGES", "PFS_INSTALLMENT_DEBT", "PFS_CREDIT_CARDS",
  "PFS_CONTINGENT", "PFS_OTHER_LIABILITIES",
];

function formatCurrency(v: number | null): string {
  if (v === null) return "";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function personalFinancialStatementTemplate(): SpreadTemplate {
  return {
    spreadType: "PERSONAL_FINANCIAL_STATEMENT",
    title: "Personal Financial Statement",
    version: 1,
    columns: ["Line Item", "Value"],
    render: (args): RenderedSpread => {
      const ownerId = args.ownerEntityId ?? null;

      // Filter to this owner's PFS facts
      const ownerFacts = args.facts.filter(
        (f) => f.owner_type === "PERSONAL" && f.owner_entity_id === ownerId,
      );

      const cellByKey: Record<string, RenderedSpreadCellV2> = {};

      for (const spec of ROW_REGISTRY) {
        if (spec.isFormula) continue;
        const fact = pickLatestFact({
          facts: ownerFacts,
          factType: spec.factType,
          factKey: spec.factKey,
        });
        cellByKey[spec.key] = factToCell(fact);
      }

      // Compute PFS_TOTAL_ASSETS
      const existingTotalAssets = pickLatestFact({
        facts: ownerFacts,
        factType: "PERSONAL_FINANCIAL_STATEMENT",
        factKey: "PFS_TOTAL_ASSETS",
      });

      if (existingTotalAssets) {
        cellByKey["PFS_TOTAL_ASSETS"] = factToCell(existingTotalAssets);
      } else {
        let sum = 0;
        let anyPresent = false;
        for (const k of ASSET_KEYS) {
          const v = cellByKey[k]?.value;
          if (typeof v === "number" && Number.isFinite(v)) {
            sum += v;
            anyPresent = true;
          }
        }
        cellByKey["PFS_TOTAL_ASSETS"] = {
          value: anyPresent ? sum : null,
          formula_ref: "SUM(asset_components)",
        };
      }

      // Compute PFS_TOTAL_LIABILITIES
      const existingTotalLiabilities = pickLatestFact({
        facts: ownerFacts,
        factType: "PERSONAL_FINANCIAL_STATEMENT",
        factKey: "PFS_TOTAL_LIABILITIES",
      });

      if (existingTotalLiabilities) {
        cellByKey["PFS_TOTAL_LIABILITIES"] = factToCell(existingTotalLiabilities);
      } else {
        let sum = 0;
        let anyPresent = false;
        for (const k of LIABILITY_KEYS) {
          const v = cellByKey[k]?.value;
          if (typeof v === "number" && Number.isFinite(v)) {
            sum += v;
            anyPresent = true;
          }
        }
        cellByKey["PFS_TOTAL_LIABILITIES"] = {
          value: anyPresent ? sum : null,
          formula_ref: "SUM(liability_components)",
        };
      }

      // Compute PFS_NET_WORTH = Total Assets - Total Liabilities
      const existingNetWorth = pickLatestFact({
        facts: ownerFacts,
        factType: "PERSONAL_FINANCIAL_STATEMENT",
        factKey: "PFS_NET_WORTH",
      });

      if (existingNetWorth) {
        cellByKey["PFS_NET_WORTH"] = factToCell(existingNetWorth);
      } else {
        const totalAssets = cellByKey["PFS_TOTAL_ASSETS"]?.value;
        const totalLiabilities = cellByKey["PFS_TOTAL_LIABILITIES"]?.value;
        const canCompute =
          typeof totalAssets === "number" && Number.isFinite(totalAssets) &&
          typeof totalLiabilities === "number" && Number.isFinite(totalLiabilities);
        cellByKey["PFS_NET_WORTH"] = {
          value: canCompute ? (totalAssets as number) - (totalLiabilities as number) : null,
          formula_ref: "TOTAL_ASSETS - TOTAL_LIABILITIES",
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
          formula: spec.isFormula ? (spec.key === "PFS_NET_WORTH" ? "TOTAL_ASSETS - TOTAL_LIABILITIES" : `SUM(${spec.key.replace("PFS_TOTAL_", "").toLowerCase()}_components)`) : null,
        };
      });

      return {
        schema_version: 2,
        title: "Personal Financial Statement",
        spread_type: "PERSONAL_FINANCIAL_STATEMENT",
        status: "ready",
        generatedAt: new Date().toISOString(),
        asOf,
        columns: ["Line Item", "Value"],
        rows,
        meta: {
          template: "personal_financial_statement",
          version: 1,
          owner_entity_id: ownerId,
          row_registry: ROW_REGISTRY.map((r) => r.key),
        },
      };
    },
  };
}
