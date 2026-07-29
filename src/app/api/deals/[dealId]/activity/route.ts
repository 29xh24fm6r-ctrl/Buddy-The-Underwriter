import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/server/authz";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeDealEvent } from "@/lib/events/dealEvents";
import { emitLenderFollowup } from "@/lib/brokerage/beatMetrics";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ACTION_LABELS: Record<string, string> = {
  "committee.decision.approved": "Committee approved",
  "committee.decision.declined": "Committee declined",
  "committee.decision.escalated": "Escalated for review",
  "exception.decision.approve": "Exception approved",
  "exception.decision.reject": "Exception rejected",
  "exception.decision.escalate": "Exception escalated",
  "pricing.decision.made": "Pricing decision recorded",
  "pricing.commit.approved": "Pricing committed",
  "pricing.commit.locked": "Pricing locked",
  "pricing.pipeline.cleared": "Pricing pipeline cleared",
  "checklist.status.set": "Checklist item updated",
  "classification.decided": "Document classified",
  "match.auto_attached": "Document matched",
  "spread.completed": "Spread completed",
  "snapshot.generated": "Snapshot generated",
  "lifecycle.stage.changed": "Stage changed",
  "lender.followup.logged": "Lender follow-up logged",
};

const LenderFollowupBodySchema = z.object({
  note: z.string().max(2000).optional(),
});

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    let userId: string;
    try {
      ({ userId } = await requireUser());
    } catch {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const sb = supabaseAdmin();

    // Fetch recent deal events — the canonical ledger
    const { data: events, error } = await sb
      .from("deal_events")
      .select("id, kind, payload, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      console.error("[GET /api/deals/[dealId]/activity] query failed:", error);
      return NextResponse.json({ ok: false, error: "query_failed" }, { status: 500 });
    }

    const timeline = (events ?? []).map((e: any) => {
      const payload = typeof e.payload === "object" ? e.payload : {};
      const actor = payload?.actor_user_id ?? payload?.meta?.actor_user_id ?? null;
      const rationale = payload?.meta?.rationale ?? payload?.rationale ?? null;
      const transition = payload?.meta?.prior_state && payload?.meta?.next_state
        ? { from: payload.meta.prior_state, to: payload.meta.next_state }
        : null;

      return {
        id: e.id,
        eventKey: e.kind,
        actionLabel: ACTION_LABELS[e.kind] ?? e.kind,
        actor: actor ?? "system",
        occurredAt: e.created_at,
        rationale,
        transition,
      };
    });

    return NextResponse.json({
      ok: true,
      dealId,
      timeline,
      count: timeline.length,
    });
  } catch (err) {
    console.error("[GET /api/deals/[dealId]/activity] error:", err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}

/**
 * POST /api/deals/[dealId]/activity — log a manual lender follow-up.
 *
 * SPEC-M2 BEAT-METRICS-1: lender_followup_count has no automated signal —
 * nothing in this system observes a lender's own follow-up questions on a
 * submitted package — so a banker logs it here. Writes to both deal_events
 * (this deal's own activity timeline, immediately visible above) and
 * brokerage_conversion_events (the cross-deal beat-metric rollup, see
 * v_beat_lender_followup_by_deal).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    let userId: string;
    try {
      ({ userId } = await requireUser());
    } catch {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    let body: z.infer<typeof LenderFollowupBodySchema>;
    try {
      body = LenderFollowupBodySchema.parse(await req.json().catch(() => ({})));
    } catch {
      return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    await writeDealEvent({
      dealId,
      bankId: access.bankId,
      kind: "lender.followup.logged",
      actorUserId: userId,
      detail: body.note,
    });

    await emitLenderFollowup(dealId, body.note, sb);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/deals/[dealId]/activity] error:", err);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
