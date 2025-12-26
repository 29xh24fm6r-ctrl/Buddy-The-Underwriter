// src/app/api/deals/[dealId]/actions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { auth } from "@clerk/nextjs/server";
import type { DealAction, DealEvent } from "@/lib/deals/contextTypes";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const { userId } = await auth();

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

    // Log event
    const event: DealEvent = {
      dealId,
      type: action,
      actor: userId,
      payload: {},
      timestamp: new Date().toISOString(),
    };

    await sb.from("deal_events").insert({
      deal_id: dealId,
      event_type: action,
      actor_id: userId,
      payload: event.payload,
      created_at: event.timestamp,
    });

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
