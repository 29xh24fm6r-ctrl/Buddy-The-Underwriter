import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { loadClassicSpreadData } from "@/lib/classicSpread/classicSpreadLoader";
import { buildClassicSpreadReviewActions, REVIEW_ACTION_STATUSES, type ReviewActionStatus } from "@/lib/classicSpread/review/buildReviewActions";
import { listReviewActions, syncReviewActions, decideReviewAction } from "@/lib/classicSpread/review/reviewActionsRepo";

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
    const actions = buildClassicSpreadReviewActions(audit);
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
    return NextResponse.json({ action: updated }, { status: 200, headers: { "cache-control": "no-store" } });
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[classic-spread/review-actions PATCH] error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
