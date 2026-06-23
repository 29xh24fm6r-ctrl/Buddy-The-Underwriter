import "server-only";
import { NextRequest, NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  applyCommitteeTaskReview,
  buildReviewAuditRow,
  isCommitteeReviewAction,
  type ReviewableTask,
} from "@/lib/research/committeeTaskReview";

export const runtime = "nodejs";
export const maxDuration = 15;

type Params = Promise<{ dealId: string }>;

/**
 * PATCH /api/deals/[dealId]/research/committee-task-review
 * SPEC-BIE-COMMITTEE-EVIDENCE-REVIEW-ACTIONS-1
 *
 * Consolidated dispatcher handler (SPEC-ROUTE-CONSOLIDATION-1) — runs inside the
 * research/[action] function so the committee-task workflow adds ZERO net
 * serverless functions (research/ keeps exactly one route.ts; avoids Buddy's
 * Vercel function-ceiling / "Deploying outputs" failure class). Behavior is
 * identical to the prior standalone route; taskId is now in the body.
 *
 * Apply a banker/analyst review action to one committee evidence task. Writes
 * durable review state + an append-only audit row. NEVER changes gate scoring,
 * trust grade, preliminary/committee eligibility, or clears a committee blocker.
 *
 * Body: { taskId, action, note?, reason? }
 * Response: { ok: true, task, review }
 *
 * mission_id / deal_id come from the trusted DB row, never the client; the task
 * is verified to belong to the URL dealId.
 */
export async function PATCH(req: NextRequest, ctx: { params: Params }) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }
    const actorId = access.userId ?? null;

    let body: { taskId?: unknown; action?: unknown; note?: unknown; reason?: unknown; result?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
    if (!taskId) {
      return NextResponse.json({ ok: false, error: "taskId_required" }, { status: 400 });
    }
    const action = body.action;
    if (!isCommitteeReviewAction(action)) {
      return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note : null;
    const reason = typeof body.reason === "string" ? body.reason : null;
    const screenResult = typeof body.result === "string" ? body.result : null;

    const sb = supabaseAdmin();

    // Load the task and verify it belongs to this deal (never trust the client
    // for mission_id / deal_id — read them from the row).
    const { data: row } = await sb
      .from("buddy_research_committee_tasks")
      .select(
        "id, mission_id, deal_id, task_type, title, status, resolved_status, auto_clear_forbidden, review_status",
      )
      .eq("id", taskId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ ok: false, error: "task_not_found" }, { status: 404 });
    }

    const task: ReviewableTask = {
      id: (row as any).id,
      mission_id: (row as any).mission_id,
      deal_id: (row as any).deal_id,
      resolved_status: (row as any).resolved_status,
      auto_clear_forbidden: (row as any).auto_clear_forbidden,
      review_status: (row as any).review_status,
    };

    const now = new Date().toISOString();
    const result = applyCommitteeTaskReview(task, action, { note, reason, result: screenResult, actorId, now });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, detail: result.detail },
        { status: result.status },
      );
    }

    // Persist review state on the task (never touches the workflow `status`,
    // file-derived `resolved_status`, or any gate/blocker state).
    const { data: updated, error: updateErr } = await sb
      .from("buddy_research_committee_tasks")
      .update({ ...result.patch, updated_at: now })
      .eq("id", taskId)
      .eq("deal_id", dealId)
      .select(
        "id, blocker_id, blocker_type, task_type, title, status, resolved_status, file_status, auto_clear_forbidden, " +
          "review_status, reviewed_by, reviewed_at, review_note, review_reason, committee_grade_accepted",
      )
      .maybeSingle();

    if (updateErr || !updated) {
      return NextResponse.json(
        { ok: false, error: updateErr?.message ?? "update_failed" },
        { status: 500 },
      );
    }

    // Append the audit row. mission_id / deal_id from the trusted DB row.
    const auditRow = buildReviewAuditRow({
      task,
      action,
      // Use the ACTUAL persisted status (screening "unable_to_verify" downgrades
      // to needs_more_evidence, so the audit reflects the real outcome).
      newStatus: result.patch.review_status,
      opts: { note, reason, actorId },
    });
    const { data: review, error: auditErr } = await sb
      .from("buddy_research_committee_task_reviews")
      .insert(auditRow)
      .select("id, action, previous_review_status, new_review_status, note, reason, actor_id, created_at")
      .maybeSingle();

    if (auditErr) {
      return NextResponse.json(
        { ok: false, error: "audit_write_failed", detail: auditErr.message, task: updated },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, task: updated, review });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected_error" },
      { status: 500 },
    );
  }
}
