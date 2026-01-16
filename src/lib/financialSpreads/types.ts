import "server-only";

export type SpreadType = "T12" | "RENT_ROLL" | "GLOBAL_CASH_FLOW";

export type SpreadStatus = "ready" | "generating" | "error";

export type RenderedSpread = {
  title: string;
  spread_type?: string;
  status?: string;
  generatedAt?: string;
  asOf?: string | null;
  columns: string[];
  rows: Array<{
    key: string;
    label: string;
    values: Array<string | number | null>;
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
};
