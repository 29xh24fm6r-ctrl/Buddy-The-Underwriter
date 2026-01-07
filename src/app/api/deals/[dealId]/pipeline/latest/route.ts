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

    const { data, error } = await sb
      .from("deal_pipeline_ledger")
      .select(
        "id, deal_id, bank_id, event_key, stage, status, ui_state, ui_message, payload, error, created_at, meta"
      )
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[pipeline/latest] query error:", error);
      // Never hard-fail the UI: return calm null state.
      return NextResponse.json({ ok: true, latestEvent: null, state: null });
    }

    if (!data) {
      // No pipeline events yet - deal just created
      return NextResponse.json({ ok: true, latestEvent: null, state: null });
    }

    return NextResponse.json({
      ok: true,
      __version: "pipeline-latest-v2-2026-01-07",
      latestEvent: data,
      state: data.stage ?? null,
    });

  } catch (error: any) {
    console.error("[pipeline/latest] unexpected error:", error);
    // Never hard-fail the UI: return calm null state.
    return NextResponse.json({
      ok: true,
      latestEvent: null,
      state: null,
    });
  }
}
