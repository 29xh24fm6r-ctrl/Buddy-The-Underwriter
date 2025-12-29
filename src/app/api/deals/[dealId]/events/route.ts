import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";
import type { AuditLedgerRow } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * GET /api/deals/[dealId]/events
 * 
 * Returns recent deal events for activity feed.
 * Source: public.audit_ledger (canonical event ledger)
 * 
 * ⚠️ IMPORTANT: Always read from audit_ledger view, NEVER from deal_events table directly.
 * audit_ledger provides the canonical read interface with input_json/output_json fields.
 */
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { dealId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    console.log("[events] has_service_role", Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY));

    const sb = supabaseAdmin();

    const { data: events, error } = await sb
      .from("audit_ledger")
      .select(
        "id, deal_id, actor_user_id, scope, action, kind, input_json, output_json, confidence, evidence_json, requires_human_review, created_at",
      )
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[/api/deals/[dealId]/events]", error.message, {
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json({
        ok: false,
        events: [],
        error: "Failed to load events",
      });
    }

    return NextResponse.json({
      ok: true,
      events: events || [],
    });
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/events]", error);
    return NextResponse.json({
      ok: false,
      events: [],
      error: "Failed to load events",
    });
  }
}
