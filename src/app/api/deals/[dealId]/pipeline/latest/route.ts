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

    // Try "new" ledger shape first (canonical UI-ready fields).
    // If the DB hasn't been migrated yet, fall back to the older columns.
    let data: any = null;

    const primary = await sb
      .from("deal_pipeline_ledger")
      .select("event_key, ui_state, ui_message, meta, created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!primary.error) {
      data = primary.data ?? null;
    } else {
      // Fallback: older shape still in DB
      const fallback = await sb
        .from("deal_pipeline_ledger")
        .select("stage, status, payload, error, created_at")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!fallback.error && fallback.data) {
        const row: any = fallback.data;
        data = {
          event_key: row.stage ?? "unknown",
          ui_state: row.status ?? "waiting",
          ui_message: null,
          meta: {
            payload: row.payload ?? null,
            error: row.error ?? null,
            legacy: true,
          },
          created_at: row.created_at,
        };
      } else {
        console.error("[pipeline/latest] query error:", primary.error ?? fallback.error);
        // Never hard-fail the UI: return calm null state.
        return NextResponse.json({ ok: true, latestEvent: null, state: null });
      }
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
    // Never hard-fail the UI: return calm null state.
    return NextResponse.json({
      ok: true,
      latestEvent: null,
      state: null,
    });
  }
}
