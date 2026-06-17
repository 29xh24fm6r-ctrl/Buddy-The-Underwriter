import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { loadClassicSpreadData } from "@/lib/classicSpread/classicSpreadLoader";
import { buildClassicSpreadReviewActions, REVIEW_ACTION_STATUSES, type ReviewActionStatus } from "@/lib/classicSpread/review/buildReviewActions";
import { listReviewActions, syncReviewActions, decideReviewAction } from "@/lib/classicSpread/review/reviewActionsRepo";
import { ensureBorrowerSourceDetailRequest } from "@/lib/classicSpread/review/ensureBorrowerSourceDetailRequest";
import { emitBuddyEvent } from "@/lib/observability/emitEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * SPEC-CLASSIC-SPREAD-BANKER-REVIEW-ACTIONS-1 #3 — ONE route file for the classic-spread review
 * action workflow:
 *   GET   — list review actions for the deal
 *   POST  — sync review actions from the latest spread audit (idempotent upsert)
 *   PATCH — record a banker decision on one action
 */

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    const rows = await listReviewActions(dealId, access.bankId);
    return NextResponse.json({ actions: rows }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[classic-spread/review-actions GET] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    // Build from the latest audit (loadClassicSpreadData already runs the gate + audit + decisions).
    const input = await loadClassicSpreadData(dealId, access.bankId);
    const audit = input.certificationAudit?.spreadAccuracy ?? null;
    // Pass periods so each action carries its resolved period end date + interim flag in finding_json
    // (used to build a precise borrower source-detail request without reloading the spread).
    const actions = buildClassicSpreadReviewActions(audit, input.periods);
    await syncReviewActions({ dealId, bankId: access.bankId, actions });
    const rows = await listReviewActions(dealId, access.bankId);
    return NextResponse.json({ synced: actions.length, actions: rows }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[classic-spread/review-actions POST] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string; note?: string | null };
    if (!body.id || !body.status || !REVIEW_ACTION_STATUSES.includes(body.status as ReviewActionStatus)) {
      return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
    }
    const updated = await decideReviewAction({
      dealId,
      bankId: access.bankId,
      id: body.id,
      status: body.status as ReviewActionStatus,
      reviewerUserId: access.userId,
      note: body.note ?? null,
      decisionJson: { status: body.status, by: access.userId, at: new Date().toISOString() },
    });
    if (!updated) return NextResponse.json({ error: "Action not found" }, { status: 404 });

    // SPEC-CLASSIC-SPREAD-BORROWER-SOURCE-DETAIL-REQUEST-1: when the banker requests borrower detail
    // on a REQUEST_SOURCE_DETAIL action, turn it into a precise borrower-facing document request on
    // the existing draft surface (idempotent). This NEVER closes/resolves the review action — the
    // spread blocker stays open until support is uploaded and the spread is regenerated.
    let borrowerRequest: Awaited<ReturnType<typeof ensureBorrowerSourceDetailRequest>> | null = null;
    if (
      updated.status === "borrower_detail_requested" &&
      updated.action_type === "REQUEST_SOURCE_DETAIL"
    ) {
      const fj = (updated.finding_json ?? {}) as { periodEndDate?: string | null; periodIsInterim?: boolean };
      try {
        borrowerRequest = await ensureBorrowerSourceDetailRequest({
          dealId,
          input: {
            reviewActionId: updated.id,
            findingKey: updated.finding_key,
            actionType: updated.action_type,
            issueType: updated.issue_type,
            statement: updated.statement,
            periodLabel: updated.period_label,
            periodEndDate: fj.periodEndDate ?? null,
            periodIsInterim: fj.periodIsInterim,
            lineItem: updated.row_label,
            sourceValue: updated.source_value,
            recommendedValue: updated.recommended_value,
            diffValue: updated.diff_value,
            reason: typeof updated.reviewer_note === "string" ? updated.reviewer_note : null,
          },
        });
        await emitBuddyEvent({
          event_type: "classic_spread_borrower_detail_requested",
          event_category: "flow",
          severity: "info",
          deal_id: dealId,
          bank_id: access.bankId,
          actor_user_id: access.userId,
          payload: {
            review_action_id: updated.id,
            finding_key: updated.finding_key,
            period: updated.period_label,
            statement: updated.statement,
            row_label: updated.row_label,
            borrower_request_id: borrowerRequest.borrowerRequestId,
            created: borrowerRequest.created,
            already_requested: borrowerRequest.alreadyRequested,
          },
        }).catch(() => {});
      } catch (e) {
        // Non-fatal: the banker decision already persisted; surface the failure without 500ing.
        borrowerRequest = null;
        console.error("[classic-spread/review-actions PATCH] borrower request error", e);
      }
    }

    return NextResponse.json(
      { action: updated, borrowerRequest },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[classic-spread/review-actions PATCH] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
