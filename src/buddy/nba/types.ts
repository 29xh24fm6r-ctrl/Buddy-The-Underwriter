export type NBAActionId =
  | "upload_docs"
  | "request_missing_docs"
  | "send_borrower_nudge"
  | "run_reconcile"
  | "start_underwriting";

export interface NBAAction {
  id: NBAActionId;
  label: string;
  description?: string;
  payload?: Record<string, any>;
}

export interface NBASuggestion {
  reason: string;
  actions: NBAAction[];
}
