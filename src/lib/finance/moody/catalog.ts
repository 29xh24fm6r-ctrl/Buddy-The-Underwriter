// src/lib/finance/moody/catalog.ts
import type { MoodyMetricId } from "@/lib/finance/types";

export type CatalogItem = {
  id: MoodyMetricId;
  label: string;
  unit: "money" | "pct" | "ratio";
  formula: string;
};

export const MOODY_CATALOG: CatalogItem[] = [
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
