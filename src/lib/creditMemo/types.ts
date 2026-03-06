/**
 * Credit Memo PDF Export — Type Definitions
 */

import type { SpreadOutputReport } from "../spreadOutput/types";
import type { FlagEngineOutput } from "../flagEngine/types";
import type { ConsolidationBridge } from "../consolidation/consolidationBridge";

export interface CreditMemoInput {
  deal_id: string;
  deal_name: string;
  borrower_name: string;
  loan_amount: number;
  loan_purpose: string;
  prepared_by: string;
  prepared_at: string;
  bank_name: string;
  spread_report: SpreadOutputReport;
  flag_report: FlagEngineOutput;
  consolidation_bridge?: ConsolidationBridge;
}

export interface CreditMemoExportResult {
  ok: boolean;
  pdf_bytes?: Uint8Array;
  error?: string;
  page_count?: number;
}
