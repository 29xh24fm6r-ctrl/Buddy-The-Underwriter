import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; quoteId: string }> },
) {
  const { dealId, quoteId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const lockReason = body.lock_reason ? String(body.lock_reason) : "Locked for committee";

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .single();
  if (dealErr || !deal || deal.bank_id !== bankId) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const { data: quote, error: qErr } = await sb
    .from("deal_pricing_quotes")
    .select("id, status")
    .eq("id", quoteId)
    .eq("deal_id", dealId)
    .single();

  if (qErr || !quote) {
    return NextResponse.json({ ok: false, error: "quote not found" }, { status: 404 });
  }
  if (quote.status === "locked") {
    return NextResponse.json({ ok: true, status: "locked" });
  }

  let underwritingSnapshotId: string | null = null;
  try {
    const snap = await sb
      .from("deal_underwriting_snapshots" as any)
      .select("id")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    underwritingSnapshotId = (snap as any)?.data?.id ?? null;
  } catch {
    underwritingSnapshotId = null;
  }

  const { data: updated, error: uErr } = await sb
    .from("deal_pricing_quotes")
    .update({
      status: "locked",
      locked_at: new Date().toISOString(),
      locked_by: "system",
      underwriting_snapshot_id: underwritingSnapshotId,
      lock_reason: lockReason,
    })
    .eq("id", quoteId)
    .eq("deal_id", dealId)
    .select("*")
    .single();

  if (uErr) {
    return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, quote: updated });
}
