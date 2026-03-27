/**
 * Reflection Types — Phase 64
 *
 * Canonical contracts for action receipts, affected surface maps,
 * and cross-surface state reflection.
 */

export type AffectedSurfaceKey =
  | "deals_command_bridge"
  | "portfolio"
  | "deal_intake"
  | "credit_committee_view"
  | "exceptions_change_review"
  | "pricing_memo_command_center"
  | "borrower_task_inbox"
  | "borrower_portal"
  | "borrower_control_record";

export type ActionReceipt = {
  ok: boolean;
  actionKey: string;
  entityType: string;
  entityId: string;
  dealId?: string;
  bankId?: string;
  ledgerEventId?: string;
  actorDisplay?: string;
  occurredAt: string;
  transition?: {
    from?: string;
    to?: string;
  };
  affectedSurfaces: AffectedSurfaceKey[];
  message: string;
};

export type InteractiveType = "direct" | "routed" | "readonly" | "none";

export type HistoryEntry = {
  eventKey: string;
  actionLabel: string;
  actor: string;
  occurredAt: string;
  rationale?: string;
  transition?: { from?: string; to?: string };
};
