import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { dealId: string } }) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const dealId = String(params.dealId || "");
  const bankId = await getCurrentBankId();

  const dealRes = await sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle();
  if (dealRes.error) return NextResponse.json({ ok: false, error: "deal_fetch_failed", detail: dealRes.error.message }, { status: 500 });
  if (!dealRes.data) return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
  if (String(dealRes.data.bank_id) !== String(bankId)) return NextResponse.json({ ok: false, error: "wrong_bank" }, { status: 403 });

  let body: any = null;
  try { body = await req.json(); } catch { body = null; }

  const mitigant_key = String(body?.mitigant_key || "").trim();
  const status = String(body?.status || "").trim();
  const note = body?.note ? String(body.note).trim() : null;

  if (!mitigant_key) return NextResponse.json({ ok: false, error: "missing_mitigant_key" }, { status: 400 });
  if (!["open", "satisfied", "waived"].includes(status)) return NextResponse.json({ ok: false, error: "invalid_status" }, { status: 400 });

  const patch: any = { status, note };

  if (status === "satisfied") {
    patch.satisfied_at = new Date().toISOString();
    patch.satisfied_by = auth.user.id;
  } else {
    patch.satisfied_at = null;
    patch.satisfied_by = null;
  }

  const up = await sb
    .from("deal_mitigants")
    .update(patch)
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("mitigant_key", mitigant_key);

  if (up.error) return NextResponse.json({ ok: false, error: "update_failed", detail: up.error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
