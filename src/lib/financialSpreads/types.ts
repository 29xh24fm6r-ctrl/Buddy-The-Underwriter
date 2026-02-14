export type SpreadType = "T12" | "RENT_ROLL" | "GLOBAL_CASH_FLOW" | "BALANCE_SHEET" | "PERSONAL_INCOME" | "PERSONAL_FINANCIAL_STATEMENT" | "STANDARD";

/** Runtime constant matching the SpreadType union — single source of truth for validation. */
export const ALL_SPREAD_TYPES: SpreadType[] = [
  "T12",
  "BALANCE_SHEET",
  "RENT_ROLL",
  "PERSONAL_INCOME",
  "PERSONAL_FINANCIAL_STATEMENT",
  "GLOBAL_CASH_FLOW",
  "STANDARD",
];

export type OwnerType = "DEAL" | "PERSONAL" | "GLOBAL";

export type SpreadStatus = "ready" | "generating" | "error";

export type RenderedSpreadSchemaVersion = 1 | 2 | 3;

export type SpreadColumnKind = "month" | "ytd" | "prior_ytd" | "ttm" | "other";

export type SpreadColumnV2 = {
  key: string; // e.g. "2025-01", "YTD", "PY_YTD", "TTM"
  label: string; // e.g. "Jan 2025", "YTD", "PY YTD", "TTM"
  kind: SpreadColumnKind;
  start_date?: string | null; // YYYY-MM-DD
  end_date?: string | null; // YYYY-MM-DD
};

export type RenderedSpreadInputRef = {
  fact_type: string;
  fact_key: string;
  fact_period_end?: string | null;
  source_document_id?: string | null;
};

export type RenderedSpreadCellV2 = {
  value: string | number | null;
  as_of_date?: string | null;
  // Multi-period support (T12 v3): values and display/provenance per column key.
  valueByCol?: Record<string, string | number | null>;
  displayByCol?: Record<string, string | null>;
  provenanceByCol?: Record<string, any | null>;
  inputs_used?: RenderedSpreadInputRef[];
  formula_ref?: string | null;
  citations?: any[];
  notes?: string | null;
};

export type RenderedSpreadCell = string | number | null | RenderedSpreadCellV2;

export type RenderedSpread = {
  schema_version?: RenderedSpreadSchemaVersion;
  // Template/schema major version (e.g., T12 v3); separate from schema_version.
  schemaVersion?: number;
  title: string;
  spread_type?: string;
  status?: string;
  generatedAt?: string;
  asOf?: string | null;
  columns: string[];
  // Optional typed columns for schema-v3 spreads.
  columnsV2?: SpreadColumnV2[];
  rows: Array<{
    key: string;
    label: string;
    section?: string | null;
    // Schema v1: values are primitive types.
    // Schema v2: values may include objects with metadata for machine-mapping.
    values: RenderedSpreadCell[];
    formula?: string | null;
    notes?: string | null;
    citations?: any[];
  }>;
  totals?: Record<string, any>;
  meta?: Record<string, any>;
};

export type FinancialFact = {
  id: string;
  deal_id: string;
  bank_id: string;
  source_document_id: string | null;
  fact_type: string;
  fact_key: string;
  fact_period_start: string | null;
  fact_period_end: string | null;
  fact_value_num: number | null;
  fact_value_text: string | null;
  currency: string | null;
  confidence: number | null;
  provenance: any;
  created_at: string;
  owner_type?: string;
  owner_entity_id?: string | null;
};

export type RentRollOccupancyStatus = "OCCUPIED" | "VACANT";

export type RentRollRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  as_of_date: string; // YYYY-MM-DD

  unit_id: string;
  unit_type: string | null;
  sqft: number | null;

  tenant_name: string | null;
  lease_start: string | null; // YYYY-MM-DD
  lease_end: string | null; // YYYY-MM-DD

  monthly_rent: number | null;
  annual_rent: number | null;
  market_rent_monthly: number | null;

  occupancy_status: RentRollOccupancyStatus;
  concessions_monthly: number | null;

  notes: string | null;
  source_document_id: string | null;
  created_at?: string;
  updated_at?: string;
};
