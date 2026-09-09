// src/buddy/signals.ts
// Canonical Buddy signal contract (single source of truth).

export type BuddySignalType =
  | "page.ready"
  | "deal.loaded"
  | "deal.ignited"
  | "deal.document.uploaded"
  | "deal.checklist.updated"
  | "deal.underwriting.started"
  | "deal.lifecycle"
  | "lifecycle"
  | "checklist.updated"
  | "pipeline.event"
  | "user.action"
  | "user.mark"
  | "ui.toast"
  | "error"
  | "api.degraded"
  | "borrower.completed"
  | "borrower.owners.attested"
  | "borrower.audit.snapshot.created"
  | "decision.audit.snapshot.created"
  | "examiner.drop.created"
  | "model.governance.exported"
  | "examiner.playbooks.exported"
  | "policy.pack.created"
  | "policy.pack.resolved"
  | "policy.frozen.validated"
  | "bank.decision.compared"
  | "sandbox.loaded"
  | "sandbox.deal.viewed"
  | "examiner.access.granted"
  | "examiner.access.revoked"
  | "examiner.viewed.snapshot"
  | "examiner.verified.integrity"
  | "examiner.access.expired"
  | "omega.invoked"
  | "omega.succeeded"
  | "omega.failed"
  | "omega.timed_out"
  | "omega.killed"
  | "pulse.mcp.tool.called"
  | "pulse.mcp.tool.failed"
  | "pulse.forwarding_failed"
  | "pulse.forwarding_recovered"
  | "pulse.forwarding_dead_lettered";

export interface BuddySignalBase {
  type: BuddySignalType;
  ts: number;
  source: string; // file/module/system emitting this signal
  dealId?: string | null;
  /**
   * Tenant override for callers that already hold a verified bank id (a
   * service grant, a route that resolved the session). Deal-scoped signals
   * resolve from the deal row when this is absent; only signals with neither
   * consult the Clerk session.
   */
  bankId?: string | null;
  payload?: Record<string, any>;
}
