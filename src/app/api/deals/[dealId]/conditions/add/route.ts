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
import { resolveDealApiContext } from "@/lib/server/dealApiContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const access = await resolveDealApiContext(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }
  const { sb, bankId, actorProfileId } = access;

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
      created_by: actorProfileId,
    });
  } catch {
    // best-effort audit log
  }

  return NextResponse.json({ ok: true, condition: insertRes.data });
}
