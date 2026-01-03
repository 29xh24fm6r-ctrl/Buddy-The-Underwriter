// src/app/api/deals/[dealId]/pipeline/latest/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/pipeline/latest
 * 
 * Returns latest pipeline state from canonical ledger.
 * UI uses this to determine what to render.
 */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Get latest pipeline event
    const { data, error } = await sb
      .from("deal_pipeline_ledger")
      .select("event_key, ui_state, ui_message, meta, created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[pipeline/latest] query error:", error);
      return NextResponse.json({
        ok: true,
        latestEvent: null,
        state: null,
      });
    }

    if (!data) {
      // No pipeline events yet - deal just created
      return NextResponse.json({
        ok: true,
        latestEvent: null,
        state: null,
      });
    }

    return NextResponse.json({
      ok: true,
      latestEvent: {
        event_key: data.event_key,
        ui_state: data.ui_state,
        ui_message: data.ui_message,
        meta: data.meta ?? {},
        created_at: data.created_at,
      },
      state: data, // keep for backward compatibility
    });

  } catch (error: any) {
    console.error("[pipeline/latest] unexpected error:", error);
    return NextResponse.json({
      ok: true,
      latestEvent: null,
      state: null,
    });
  }
}
