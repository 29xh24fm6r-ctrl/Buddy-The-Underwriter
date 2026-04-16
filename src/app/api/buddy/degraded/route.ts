import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const dealId = url.searchParams.get("dealId");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "10"), 50);

    if (!dealId) {
      return NextResponse.json({ ok: false, error: "dealId required" }, { status: 400 });
    }

    // Use ensureDealBankAccess — resolves bankId + verifies tenant isolation.
    // Also adds runtime/maxDuration exports above to prevent 504 timeouts.
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data, error } = await sb
      .from("buddy_signal_ledger")
      .select("id, created_at, source, payload")
      .eq("bank_id", access.bankId)
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

    return NextResponse.json({ ok: true, degraded: items.length > 0, items, dealId });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "unhandled_error" },
      { status: 500 }
    );
  }
}
