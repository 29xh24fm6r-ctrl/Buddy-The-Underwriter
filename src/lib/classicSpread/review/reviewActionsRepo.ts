import "server-only";

/**
 * SPEC-CLASSIC-SPREAD-BANKER-REVIEW-ACTIONS-1 — IO layer for classic_spread_review_actions.
 *
 * Service-role written; the route enforces bank scope (ensureDealBankAccess + explicit bank_id
 * filters). The sync UPSERTS on (bank_id, deal_id, finding_key) WITHOUT touching status/reviewer
 * columns, so re-syncing the latest audit never duplicates and never clobbers a banker decision.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { ClassicSpreadReviewAction, ReviewActionStatus } from "./buildReviewActions";
import type { ReviewDecision } from "./applyReviewDecisions";

const TABLE = "classic_spread_review_actions";

export type ReviewActionRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  spread_id: string | null;
  period_label: string;
  statement: string;
  row_label: string;
  action_type: string;
  issue_type: string;
  severity: string;
  status: ReviewActionStatus;
  recommended_value: number | null;
  source_value: number | null;
  diff_value: number | null;
  source_document_id: string | null;
  finding_key: string;
  finding_json: unknown;
  reviewer_user_id: string | null;
  reviewer_note: string | null;
  decision_json: unknown;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Upsert the latest audit's review actions. Idempotent: status/reviewer columns are NOT sent, so
 *  existing rows keep their banker decision and only the audit-derived fields refresh. */
export async function syncReviewActions(args: {
  dealId: string;
  bankId: string;
  spreadId?: string | null;
  actions: ClassicSpreadReviewAction[];
}): Promise<{ synced: number }> {
  const { dealId, bankId, spreadId = null, actions } = args;
  if (actions.length === 0) return { synced: 0 };
  const sb = supabaseAdmin();
  const rows = actions.map((a) => ({
    deal_id: dealId,
    bank_id: bankId,
    spread_id: spreadId,
    period_label: a.periodLabel,
    statement: a.statement,
    row_label: a.rowLabel,
    action_type: a.actionType,
    issue_type: a.issueType,
    severity: a.severity,
    recommended_value: a.recommendedValue,
    source_value: a.sourceValue,
    diff_value: a.diffValue,
    source_document_id: a.sourceDocumentId,
    finding_key: a.findingKey,
    finding_json: a.findingJson,
    // status / reviewer_* / decision_json / reviewed_at intentionally omitted — preserved on conflict.
  }));
  const { error } = await (sb as any)
    .from(TABLE)
    .upsert(rows, { onConflict: "bank_id,deal_id,finding_key", ignoreDuplicates: false });
  if (error) throw new Error(`sync_review_actions_failed: ${error.message}`);
  return { synced: rows.length };
}

export async function listReviewActions(dealId: string, bankId: string): Promise<ReviewActionRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await (sb as any)
    .from(TABLE)
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("finding_key", { ascending: true });
  if (error) throw new Error(`list_review_actions_failed: ${error.message}`);
  return (data ?? []) as ReviewActionRow[];
}

/** Record a banker decision. Stamps reviewed_at + reviewer_user_id (anti silent-auto-clear). */
export async function decideReviewAction(args: {
  dealId: string;
  bankId: string;
  id: string;
  status: ReviewActionStatus;
  reviewerUserId: string;
  note?: string | null;
  decisionJson?: unknown;
}): Promise<ReviewActionRow | null> {
  const { dealId, bankId, id, status, reviewerUserId, note = null, decisionJson = null } = args;
  const sb = supabaseAdmin();
  const reviewedAt = status === "open" ? null : new Date().toISOString();
  const { data, error } = await (sb as any)
    .from(TABLE)
    .update({
      status,
      reviewer_user_id: reviewerUserId,
      reviewer_note: note,
      decision_json: decisionJson,
      reviewed_at: reviewedAt,
    })
    .eq("id", id)
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`decide_review_action_failed: ${error.message}`);
  return (data ?? null) as ReviewActionRow | null;
}

/** Decisions for the render/audit apply path. Non-fatal: returns [] if the table is absent. */
export async function loadReviewDecisions(dealId: string, bankId: string): Promise<ReviewDecision[]> {
  try {
    const rows = await listReviewActions(dealId, bankId);
    return rows.map((r) => ({
      findingKey: r.finding_key,
      status: r.status,
      reviewedAt: r.reviewed_at,
      reviewerUserId: r.reviewer_user_id,
      note: r.reviewer_note,
    }));
  } catch {
    return [];
  }
}
