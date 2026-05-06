/**
 * POST /api/deals/[dealId]/conditions/add
 *
 * SPEC-06 — adds a new banker-authored condition to a deal. Thin handler
 * that inserts a row into `deal_conditions` with `source="manual"`.
 *
 * Body:
 *   { title: string; description?: string; category?: string; due_date?: string }
 */
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
  if (!auth?.user) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const { dealId } = await ctx.params;
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

  const title = String(body?.title ?? "").trim();
  const description = body?.description ? String(body.description).trim() : null;
  const category = body?.category ? String(body.category).trim() : null;
  const due_date = body?.due_date ? String(body.due_date) : null;

  if (!title) {
    return NextResponse.json(
      { ok: false, error: "missing_title" },
      { status: 400 },
    );
  }

  const insertRes = await (sb as any)
    .from("deal_conditions")
    .insert({
      deal_id: dealId,
      bank_id: bankId,
      title,
      description,
      category,
      due_date,
      status: "open",
      source: "manual",
      source_key: null,
    })
    .select(
      "id, title, description, category, status, source, source_key, due_date, created_at, updated_at",
    )
    .single();

  if (insertRes.error) {
    return NextResponse.json(
      { ok: false, error: "insert_failed", detail: insertRes.error.message },
      { status: 500 },
    );
  }

  try {
    await (sb as any).from("deal_condition_events").insert({
      condition_id: insertRes.data.id,
      deal_id: dealId,
      bank_id: bankId,
      action: "added",
      payload: { source: "stage_cockpit" },
      created_by: auth.user.id,
    });
  } catch {
    // best-effort audit log
  }

  return NextResponse.json({ ok: true, condition: insertRes.data });
}
