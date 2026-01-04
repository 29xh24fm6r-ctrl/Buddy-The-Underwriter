// src/app/api/deals/[dealId]/checklist/list/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/checklist/list
 * 
 * Returns checklist items from deal_checklist_items.
 * Uses admin client to bypass RLS (server-side only).
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const sb = supabaseAdmin();

    const { data: items, error } = await sb
      .from("deal_checklist_items")
      .select("*")
      .eq("deal_id", dealId)
      .order("required", { ascending: false })
      .order("document_category", { ascending: true })
      .order("document_label", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      state: items && items.length > 0 ? "ready" : "empty",
      items: items || [],
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/checklist/list] error", e);
    return NextResponse.json(
      { 
        ok: false, 
        error: "Failed to load checklist", 
        items: [],
        debug_error: e?.message || String(e)
      },
      { status: 500 }
    );
  }
}
