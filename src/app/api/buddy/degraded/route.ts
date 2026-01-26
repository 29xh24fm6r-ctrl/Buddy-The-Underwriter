/**
 * GET /api/buddy/degraded
 *
 * Returns recent degraded API responses for a deal.
 * Used by Builder Observer to show reliability issues.
 *
 * Query params:
 * - dealId: (required) The deal to check
 * - limit: (optional) Max items to return (default: 10)
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const dealId = url.searchParams.get("dealId");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "10"), 50);

    if (!dealId) {
      return NextResponse.json({ ok: false, error: "dealId required" }, { status: 400 });
    }

    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Get degraded events from the last hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data, error } = await sb
      .from("buddy_signal_ledger")
      .select("id, created_at, source, payload")
      .eq("bank_id", bankId)
      .eq("deal_id", dealId)
      .eq("type", "api.degraded")
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const items = (data ?? []).map((r) => ({
      id: r.id,
      ts: r.created_at,
      endpoint: r.source,
      code: (r.payload as any)?.code ?? "unknown",
      message: (r.payload as any)?.message ?? "",
      correlationId: (r.payload as any)?.correlationId ?? "",
    }));

    return NextResponse.json({
      ok: true,
      degraded: items.length > 0,
      items,
      dealId,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "unhandled_error" },
      { status: 500 }
    );
  }
}
