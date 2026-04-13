/**
 * Agent Approval Governance — SR 11-7 compliance
 *
 * Provides immutable approval event recording and verification.
 * No outbound borrower communication is permitted without an approved event.
 *
 * Run guard: node --import tsx --test src/lib/agentWorkflows/__tests__/approvalGuard.test.ts
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ───────────────────────────────────────────────────────────

export type ApprovalDecision = "approved" | "rejected" | "revoked";

export type RecordApprovalInput = {
  entityType: string;
  entityId: string;
  decision: ApprovalDecision;
  decidedBy: string;
  snapshotJson: Record<string, unknown>;
  reason?: string;
};

export type ApprovalResult = {
  ok: boolean;
  eventId?: string;
  error?: string;
};

// ── Record ──────────────────────────────────────────────────────────

/**
 * Record an immutable approval event.
 * MUST be called before any outbound borrower communication.
 */
export async function recordApprovalEvent(
  sb: SupabaseClient,
  input: RecordApprovalInput,
): Promise<ApprovalResult> {
  const { data, error } = await sb
    .from("agent_approval_events")
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      decision: input.decision,
      decided_by: input.decidedBy,
      snapshot_json: input.snapshotJson,
      reason: input.reason ?? null,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[approval] recordApprovalEvent failed:", error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true, eventId: data.id };
}

// ── Verify ──────────────────────────────────────────────────────────

/**
 * Verify that an approved event exists for an entity.
 * MUST be called before dispatching any outbound communication.
 *
 * Returns true only if at least one 'approved' decision exists
 * and no subsequent 'revoked' decision has been recorded.
 */
export async function verifyApprovalExists(
  sb: SupabaseClient,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  // Check for approved event
  const { data: approved } = await sb
    .from("agent_approval_events")
    .select("id, decided_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("decision", "approved")
    .order("decided_at", { ascending: false })
    .limit(1);

  if (!approved?.length) return false;

  // Check for subsequent revocation
  const { data: revoked } = await sb
    .from("agent_approval_events")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .eq("decision", "revoked")
    .gt("decided_at", approved[0].decided_at)
    .limit(1);

  return !revoked?.length;
}

// ── Snapshot Builder ────────────────────────────────────────────────

/**
 * Build a snapshot for a draft borrower request at approval time.
 * Captures the exact content that was approved.
 */
export function buildDraftApprovalSnapshot(draft: {
  draft_subject: string;
  draft_message: string;
  evidence: unknown;
  missing_document_type: string;
}): Record<string, unknown> {
  return {
    draft_subject: draft.draft_subject,
    draft_message: draft.draft_message,
    evidence: draft.evidence,
    missing_document_type: draft.missing_document_type,
    snapshot_version: "1",
  };
}
