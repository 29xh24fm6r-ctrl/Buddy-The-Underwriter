// src/lib/finance/pnl/catalog.ts
import type { PnlMetricId } from "@/lib/finance/types";

export type CatalogItem = {
  id: PnlMetricId;
  label: string;
  unit: "money" | "pct" | "ratio";
  formula: string;
};

export const PNL_CATALOG: CatalogItem[] = [
  {
    id: "gross_margin_pct",
    label: "Gross Margin",
    unit: "pct",
    formula: "Gross Profit / Revenue",
  },
  {
    id: "ebitda",
    label: "EBITDA",
    unit: "money",
    formula: "Net Income + Interest + Taxes + D&A",
  },
  {
    id: "current_ratio",
    label: "Current Ratio",
    unit: "ratio",
    formula: "Current Assets / Current Liabilities",
  },
  {
    id: "debt_to_equity",
    label: "Debt to Equity",
    unit: "ratio",
    formula: "Total Liabilities / Equity",
  },
];
