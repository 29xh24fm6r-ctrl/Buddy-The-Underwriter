import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { draftConditionFromMitigant } from "@/lib/conditions/mitigantTemplates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isoInDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

async function bestEffortCreateReminderSubscription(opts: {
  bankId: string;
  dealId: string;
  conditionId: string;
  dueIso: string | null;
}) {
  try {
    const sb = supabaseAdmin();
    const stop_after = opts.dueIso || isoInDays(14);
    const next_run_at = isoInDays(1);
    const cadence_days = 2;

    const ins = await sb
      .from("deal_reminder_subscriptions")
      .insert({
        deal_id: opts.dealId,
        active: true,
        next_run_at,
        cadence_days,
        stop_after,
      })
      .select("id")
      .maybeSingle();

    if (ins.error || !ins.data?.id) return null;

    return String(ins.data.id);
  } catch {
    return null;
  }
}

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
  const dueDaysOverride = body?.due_days !== undefined ? Number(body.due_days) : null;

  const mit = await sb
    .from("deal_mitigants")
    .select("mitigant_key, mitigant_label, reason_rule_keys, status")
    .eq("deal_id", dealId);

  if (mit.error) return NextResponse.json({ ok: false, error: "mitigants_fetch_failed", detail: mit.error.message }, { status: 500 });

  const open = (mit.data ?? []).filter((m: any) => String(m.status) === "open");

  const created: any[] = [];
  const skipped: any[] = [];

  for (const m of open) {
    const mitigant_key = String(m.mitigant_key || "").trim();
    if (!mitigant_key) continue;

    const exists = await sb
      .from("deal_conditions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("source", "policy")
      .eq("source_key", mitigant_key)
      .maybeSingle();

    if (exists.data?.id) {
      skipped.push({ mitigant_key, reason: "already_exists", condition_id: exists.data.id });
      continue;
    }

    const draft = draftConditionFromMitigant(mitigant_key, String(m.mitigant_label || ""));

    const dueIso =
      dueDaysOverride !== null && Number.isFinite(dueDaysOverride) && dueDaysOverride > 0
        ? isoInDays(dueDaysOverride)
        : (draft.default_due_days ? isoInDays(draft.default_due_days) : null);

    const ins = await sb
      .from("deal_conditions")
      .insert({
        deal_id: dealId,
        bank_id: bankId,
        title: draft.title,
        description: draft.description ?? null,
        category: "policy",
        status: "open",
        source: "policy",
        source_key: mitigant_key,
        required_docs: draft.required_docs,
        due_date: dueIso,
        borrower_message_subject: draft.borrower_subject,
        borrower_message_body: draft.borrower_body,
        created_by: auth.user.id,
      })
      .select("id")
      .maybeSingle();

    if (ins.error || !ins.data?.id) {
      skipped.push({ mitigant_key, reason: "insert_failed", detail: ins.error?.message || "unknown" });
      continue;
    }

    const conditionId = String(ins.data.id);

    const subId = await bestEffortCreateReminderSubscription({
      bankId,
      dealId,
      conditionId,
      dueIso,
    });

    if (subId) {
      await sb
        .from("deal_conditions")
        .update({ reminder_subscription_id: subId })
        .eq("id", conditionId)
        .eq("deal_id", dealId);
    }

    try {
      await sb.from("deal_condition_events").insert({
        condition_id: conditionId,
        deal_id: dealId,
        bank_id: bankId,
        action: "created",
        payload: { mitigant_key, reason_rule_keys: m.reason_rule_keys || [], reminder_subscription_id: subId || null },
        created_by: auth.user.id,
      });
    } catch {}

    created.push({ mitigant_key, condition_id: conditionId, reminder_subscription_id: subId || null });
  }

  return NextResponse.json({ ok: true, created, skipped, open_mitigants: open.length });
}
