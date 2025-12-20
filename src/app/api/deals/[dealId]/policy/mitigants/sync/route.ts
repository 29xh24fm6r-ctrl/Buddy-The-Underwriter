import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sync mitigants into deal_mitigants table.
 * Input: { actions: [{key,label,priority,reason_rule_keys}] }
 * - Upserts (deal_id, mitigant_key)
 * - Never auto-closes; user must mark satisfied/waived
 */
export async function POST(req: Request, { params }: { params: { dealId: string } }) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const dealId = String(params.dealId || "");
  if (!dealId) return NextResponse.json({ ok: false, error: "missing_deal_id" }, { status: 400 });

  const bankId = await getCurrentBankId();

  const dealRes = await sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle();
  if (dealRes.error) return NextResponse.json({ ok: false, error: "deal_fetch_failed", detail: dealRes.error.message }, { status: 500 });
  if (!dealRes.data) return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
  if (String(dealRes.data.bank_id) !== String(bankId)) return NextResponse.json({ ok: false, error: "wrong_bank" }, { status: 403 });

  let body: any = null;
  try { body = await req.json(); } catch { body = null; }

  const actions = Array.isArray(body?.actions) ? body.actions : [];
  const rows = actions
    .map((a: any) => ({
      deal_id: dealId,
      bank_id: bankId,
      mitigant_key: String(a?.key || "").trim(),
      mitigant_label: String(a?.label || "").trim(),
      reason_rule_keys: Array.isArray(a?.reason_rule_keys) ? a.reason_rule_keys.map((x: any) => String(x)) : [],
    }))
    .filter((r: any) => r.mitigant_key && r.mitigant_label);

  if (rows.length === 0) return NextResponse.json({ ok: true, upserted: 0 });

  // Upsert, but preserve existing status fields by only writing label/reasons on conflict
  const up = await sb
    .from("deal_mitigants")
    .upsert(
      rows.map((r: any) => ({
        deal_id: r.deal_id,
        bank_id: r.bank_id,
        mitigant_key: r.mitigant_key,
        mitigant_label: r.mitigant_label,
        reason_rule_keys: r.reason_rule_keys,
      })),
      { onConflict: "deal_id,mitigant_key" }
    );

  if (up.error) return NextResponse.json({ ok: false, error: "sync_failed", detail: up.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, upserted: rows.length });
}
