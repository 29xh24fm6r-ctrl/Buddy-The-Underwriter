import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user)
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );

  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();

  const dealRes = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealRes.error)
    return NextResponse.json(
      { ok: false, error: "deal_fetch_failed", detail: dealRes.error.message },
      { status: 500 },
    );
  if (!dealRes.data)
    return NextResponse.json(
      { ok: false, error: "deal_not_found" },
      { status: 404 },
    );
  if (String(dealRes.data.bank_id) !== String(bankId))
    return NextResponse.json(
      { ok: false, error: "wrong_bank" },
      { status: 403 },
    );

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const condition_id = String(body?.condition_id || "").trim();
  const status = String(body?.status || "").trim();
  const note = body?.note ? String(body.note).trim() : null;

  if (!condition_id)
    return NextResponse.json(
      { ok: false, error: "missing_condition_id" },
      { status: 400 },
    );
  if (!["open", "satisfied", "waived", "rejected"].includes(status))
    return NextResponse.json(
      { ok: false, error: "invalid_status" },
      { status: 400 },
    );

  const cur = await sb
    .from("deal_conditions")
    .select("id, source, source_key")
    .eq("id", condition_id)
    .eq("deal_id", dealId)
    .maybeSingle();

  if (cur.error)
    return NextResponse.json(
      { ok: false, error: "condition_fetch_failed", detail: cur.error.message },
      { status: 500 },
    );
  if (!cur.data)
    return NextResponse.json(
      { ok: false, error: "condition_not_found" },
      { status: 404 },
    );

  const up = await sb
    .from("deal_conditions")
    .update({ status })
    .eq("id", condition_id)
    .eq("deal_id", dealId);

  if (up.error)
    return NextResponse.json(
      { ok: false, error: "update_failed", detail: up.error.message },
      { status: 500 },
    );

  if (String(cur.data.source) === "policy" && cur.data.source_key) {
    const mitigant_key = String(cur.data.source_key);

    if (status === "satisfied") {
      await sb
        .from("deal_mitigants")
        .update({
          status: "satisfied",
          satisfied_at: new Date().toISOString(),
          satisfied_by: auth.user.id,
          note,
        })
        .eq("deal_id", dealId)
        .eq("mitigant_key", mitigant_key);
    } else if (status === "waived") {
      await sb
        .from("deal_mitigants")
        .update({
          status: "waived",
          note,
        })
        .eq("deal_id", dealId)
        .eq("mitigant_key", mitigant_key);
    } else if (status === "open") {
      await sb
        .from("deal_mitigants")
        .update({
          status: "open",
          satisfied_at: null,
          satisfied_by: null,
          note: null,
        })
        .eq("deal_id", dealId)
        .eq("mitigant_key", mitigant_key);
    }
  }

  try {
    await sb.from("deal_condition_events").insert({
      condition_id,
      deal_id: dealId,
      bank_id: bankId,
      action: "status_change",
      payload: { status, note },
      created_by: auth.user.id,
    });
  } catch {}

  return NextResponse.json({ ok: true });
}
