// src/app/api/deals/[dealId]/actions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";
import type { DealAction, DealEvent } from "@/lib/deals/contextTypes";

export const dynamic = "force-dynamic";

function describeAction(action: string) {
  switch (action) {
    case "request-document":
      return { title: "Requested document", level: "info", kind: "checklist", event_type: "checklist", status: "info" };
    case "mark-condition":
      return { title: "Condition satisfied", level: "success", kind: "checklist", event_type: "checklist", status: "completed" };
    case "approve":
      return { title: "Deal approved", level: "success", kind: "readiness", event_type: "readiness", status: "completed" };
    case "decline":
      return { title: "Deal declined", level: "error", kind: "readiness", event_type: "readiness", status: "failed" };
    case "escalate":
      return { title: "Escalated to committee", level: "warning", kind: "other", event_type: "other", status: "blocked" };
    case "share":
      return { title: "Shared deal", level: "info", kind: "other", event_type: "other", status: "info" };
    default:
      return { title: `Action: ${action}`, level: "info", kind: "other", event_type: "other", status: "info" };
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const { userId } = await clerkAuth();

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { action } = body as { action: DealAction };

    if (!action) {
      return NextResponse.json(
        { ok: false, error: "Missing action" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    // Verify deal exists and belongs to bank
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .single();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    // Log event (best-effort, don't fail request if this fails)
    const event: DealEvent = {
      dealId,
      type: action,
      actor: userId,
      payload: {},
      timestamp: new Date().toISOString(),
    };

    const desc = describeAction(action);

    // Try to write to deal_timeline_events (for CinematicTimeline)
    const timelineInsert = await sb.from("deal_timeline_events").insert({
      deal_id: dealId,
      event_type: desc.event_type,
      title: desc.title,
      detail: JSON.stringify({ action, by: userId }),
      level: desc.level,
      kind: desc.kind,
      status: desc.status,
      meta: { action, by: userId },
      visible_to_borrower: false,
      created_at: event.timestamp,
    });

    if (timelineInsert.error) {
      console.warn("[actions] Timeline insert failed (non-fatal):", timelineInsert.error);
    }

    // Also write to deal_events for backward compatibility
    const insertResult = await sb.from("deal_events").insert({
      deal_id: dealId,
      event_type: action,
      actor_id: userId,
      payload: event.payload,
      created_at: event.timestamp,
    });

    if (insertResult.error) {
      console.warn("[actions] Event insert failed (non-fatal):", insertResult.error);
    }

    // Handle action (placeholder implementations)
    switch (action) {
      case "request-document":
        // TODO: implement document request logic
        break;

      case "mark-condition":
        // TODO: implement condition satisfaction logic
        break;

      case "approve":
        await sb
          .from("deals")
          .update({ stage: "approved" })
          .eq("id", dealId);
        break;

      case "decline":
        await sb
          .from("deals")
          .update({ stage: "declined" })
          .eq("id", dealId);
        break;

      case "escalate":
        await sb
          .from("deals")
          .update({ stage: "committee" })
          .eq("id", dealId);
        break;

      case "share":
        // TODO: implement share logic
        break;

      default:
        return NextResponse.json(
          { ok: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }

    return NextResponse.json({ ok: true, event });
  } catch (e: any) {
    console.error("POST /api/deals/[dealId]/actions error:", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
