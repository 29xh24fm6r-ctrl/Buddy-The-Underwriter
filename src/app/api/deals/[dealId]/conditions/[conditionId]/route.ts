/**
 * PATCH /api/deals/[dealId]/conditions/[conditionId]
 *
 * SPEC-06 — banker inline-edits a single condition's title / description /
 * category / due_date. Status changes still flow through
 * /conditions/set-status.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = new Set([
  "title",
  "description",
  "category",
  "due_date",
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; conditionId: string }> },
) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const { dealId, conditionId } = await ctx.params;
  const bankId = await getCurrentBankId();

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealErr) {
    return NextResponse.json(
      { ok: false, error: "deal_fetch_failed", detail: dealErr.message },
      { status: 500 },
    );
  }
  if (!deal) {
    return NextResponse.json(
      { ok: false, error: "deal_not_found" },
      { status: 404 },
    );
  }
  if (String(deal.bank_id) !== String(bankId)) {
    return NextResponse.json(
      { ok: false, error: "wrong_bank" },
      { status: 403 },
    );
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    update[k] =
      typeof v === "string"
        ? v.trim()
        : v === null
          ? null
          : v;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { ok: false, error: "no_updatable_fields" },
      { status: 400 },
    );
  }
  (update as Record<string, unknown>).updated_at = new Date().toISOString();

  const updateRes = await (sb as any)
    .from("deal_conditions")
    .update(update)
    .eq("id", conditionId)
    .eq("deal_id", dealId)
    .select(
      "id, title, description, category, status, source, source_key, due_date, created_at, updated_at",
    )
    .single();

  if (updateRes.error) {
    return NextResponse.json(
      { ok: false, error: "update_failed", detail: updateRes.error.message },
      { status: 500 },
    );
  }
  if (!updateRes.data) {
    return NextResponse.json(
      { ok: false, error: "condition_not_found" },
      { status: 404 },
    );
  }

  try {
    await (sb as any).from("deal_condition_events").insert({
      condition_id: conditionId,
      deal_id: dealId,
      bank_id: bankId,
      action: "edited",
      payload: { fields: Object.keys(update), source: "stage_cockpit" },
      created_by: auth.user.id,
    });
  } catch {
    // best-effort audit log
  }

  return NextResponse.json({ ok: true, condition: updateRes.data });
}
