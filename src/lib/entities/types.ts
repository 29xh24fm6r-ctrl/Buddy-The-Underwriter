// src/lib/entities/types.ts

export type EntityKind = 'OPCO' | 'PROPCO' | 'HOLDCO' | 'PERSON' | 'GROUP';

export type DealEntity = {
  id: string;
  deal_id: string;
  user_id: string;
  name: string;
  entity_kind: EntityKind;
  legal_name?: string;
  ein?: string;
  ownership_percent?: number;
  notes?: string;
  meta?: {
    detected_eins?: string[];
    detected_names?: string[];
    [key: string]: any;
  };
  created_at: string;
  updated_at: string;
};

export type EntityFinancialPeriod = {
  id: string;
  deal_id: string;
  user_id: string;
  entity_id: string;
  source: 'OCR' | 'MANUAL' | 'IMPORT';
  source_item_ids?: string[];
  period_type: 'ANNUAL' | 'INTERIM' | 'TTM';
  fiscal_year?: number;
  fiscal_year_end?: string; // MM-DD
  period_start?: string;
  period_end?: string;
  currency: string;
  statement: any; // Normalized financial statement
  completeness_score?: number;
  warnings?: string[];
  meta?: any;
  created_at: string;
  updated_at: string;
};

export type CombinedSpread = {
  id: string;
  deal_id: string;
  user_id: string;
  scope: 'GROUP' | 'SELECTED' | 'CUSTOM';
  entity_ids: string[];
  period_type: 'ANNUAL' | 'INTERIM' | 'TTM';
  fiscal_year?: number;
  period_end?: string;
  currency: string;
  combined_statement: any;
  flags: {
    intercompany_present?: boolean;
    missing_entities?: string[];
    mismatched_periods?: string[];
    [key: string]: any;
  };
  warnings?: string[];
  source_period_ids?: string[];
  meta?: any;
  created_at: string;
  updated_at: string;
};

export type PackItem = {
  id: string;
  deal_id: string;
  user_id: string;
  pack_id?: string;
  job_id: string;
  stored_name: string;
  original_name?: string;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  ocr_result?: any;
  classification?: any;
  entity_id?: string;
  suggested_entity_id?: string;
  suggestion_confidence?: number;
  suggestion_reasons?: string[];
  meta?: {
    detected_eins?: string[];
    detected_names?: string[];
    [key: string]: any;
  };
  created_at: string;
  updated_at: string;
};
