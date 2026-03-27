import "server-only";

import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
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
};

export async function GET(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
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
