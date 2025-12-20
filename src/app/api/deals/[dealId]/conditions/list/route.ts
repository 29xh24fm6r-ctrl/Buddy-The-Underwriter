import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { dealId: string } }) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });

  const dealId = String(params.dealId || "");
  const bankId = await getCurrentBankId();

  const dealRes = await sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle();
  if (dealRes.error) return NextResponse.json({ ok: false, error: "deal_fetch_failed", detail: dealRes.error.message }, { status: 500 });
  if (!dealRes.data) return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
  if (String(dealRes.data.bank_id) !== String(bankId)) return NextResponse.json({ ok: false, error: "wrong_bank" }, { status: 403 });

  const q = await sb
    .from("deal_conditions")
    .select("id,title,description,category,status,source,source_key,required_docs,due_date,borrower_message_subject,borrower_message_body,reminder_subscription_id,created_at,updated_at")
    .eq("deal_id", dealId)
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });

  if (q.error) return NextResponse.json({ ok: false, error: "list_failed", detail: q.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, items: q.data ?? [] });
}
