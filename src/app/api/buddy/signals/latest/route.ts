// src/app/api/buddy/signals/latest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const since = url.searchParams.get("since");
    const dealId = url.searchParams.get("dealId");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    let q = sb
      .from("buddy_signal_ledger")
      .select("id, created_at, deal_id, type, source, payload")
      .eq("bank_id", bankId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (dealId) q = q.eq("deal_id", dealId);
    if (since) q = q.gte("created_at", since);

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      items:
        (data ?? []).map((r) => ({
          id: r.id,
          ts: new Date(r.created_at).getTime(),
          type: r.type,
          source: r.source,
          dealId: r.deal_id ?? undefined,
          payload: r.payload ?? undefined,
        })) ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "unhandled_error" },
      { status: 500 }
    );
  }
}
