/**
 * Pre-Approval Simulator: Type Definitions
 * 
 * Contracts for simulation mode, outcomes, offers, and results.
 */

export type SimMode = 
  | "SBA_7A" 
  | "SBA_EXPRESS" 
  | "SBA_504"
  | "CONVENTIONAL_CASHFLOW" 
  | "CONVENTIONAL_CRE" 
  | "DUAL"; // Evaluate both SBA and Conventional

export type SimOutcomeStatus = "pass" | "conditional" | "fail";

export interface SimReason {
  code: string;
  title: string;
  detail: string;
  source: "SBA" | "BANK";
  evidence?: any;
  confidence: number;
}

export interface SimOutcome {
  status: SimOutcomeStatus;
  reasons: SimReason[];
}

export interface SimOffer {
  program: "SBA" | "CONVENTIONAL";
  product: string; // e.g., "SBA 7(a)" or "Conventional Term"
  amount_range: { min: number; max: number };
  term_months_range: { min: number; max: number };
  rate_note: string; // Placeholder language (no pricing promises)
  payment_note?: string;
  constraints: string[]; // DSCR floor, LTV caps, etc.
  conditions: string[];
  confidence: number;
}

export interface SimPunchlist {
  borrower_actions: string[];
  banker_actions: string[];
  system_reviews: string[];
}

export interface SimResult {
  deal_id: string;
  mode: SimMode;
  sba: SimOutcome;
  conventional: SimOutcome;
  offers: SimOffer[];
  punchlist: SimPunchlist;
  truth: any; // Simulated truth snapshot (not committed)
  confidence: number;
}

/**
 * Simulation run record from database
 */
export interface SimRun {
  id: string;
  deal_id: string;
  bank_id: string;
  status: "running" | "succeeded" | "failed";
  progress: number;
  current_stage: string;
  logs: Array<{
    stage: string;
    message: string;
    timestamp: string;
  }>;
  error_json?: any;
  triggered_by?: string;
  created_at: string;
  updated_at: string;
  finished_at?: string;
}

/**
 * Simulation result record from database
 */
export interface SimResultRecord {
  id: string;
  run_id: string;
  deal_id: string;
  bank_id: string;
  truth_json: any;
  offers_json: SimOffer[];
  punchlist_json: SimPunchlist;
  sba_outcome_json: SimOutcome;
  conventional_outcome_json: SimOutcome;
  confidence: number;
  created_at: string;  
  // Helper getters for parsed JSONB (for UI convenience)
  sba_outcome?: SimOutcome;
  conventional_outcome?: SimOutcome;
  offers?: SimOffer[];
  punchlist?: SimPunchlist;
  truth?: Record<string, any>;}
