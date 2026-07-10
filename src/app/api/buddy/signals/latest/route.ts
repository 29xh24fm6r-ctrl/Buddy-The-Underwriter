// src/app/api/buddy/signals/latest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { tryGetCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const since = url.searchParams.get("since");
    const dealId = url.searchParams.get("dealId");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

    // This widget mounts in the root layout and polls on every page,
    // including public/unauthenticated ones and the brief window before a
    // freshly-signed-in session cookie propagates. "No tenant resolved yet"
    // is an expected, common state here — not a server error — so degrade
    // to an empty result instead of a hard 500 that spams logs/console for
    // every anonymous visitor and every pre-hydration poll.
    const bankPick = await tryGetCurrentBankId();
    if (!bankPick.ok) {
      return NextResponse.json({ ok: true, items: [] });
    }
    const bankId = bankPick.bankId;
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
    console.error("[buddy/signals/latest] unhandled error", {
      message: e?.message,
      name: e?.name,
      stack: e?.stack,
      cause: e?.cause,
    });
    return NextResponse.json(
      { ok: false, error: e?.message || "unhandled_error" },
      { status: 500 }
    );
  }
}
