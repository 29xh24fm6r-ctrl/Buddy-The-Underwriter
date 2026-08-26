/**
 * PATCH /api/deals/[dealId]/conditions/[conditionId]
 *
 * SPEC-06 — banker inline-edits a single condition's title / description /
 * category / due_date. Status changes still flow through
 * /conditions/set-status.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveDealApiContext } from "@/lib/server/dealApiContext";

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
  const { dealId, conditionId } = await ctx.params;
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
      created_by: actorProfileId,
    });
  } catch {
    // best-effort audit log
  }

  return NextResponse.json({ ok: true, condition: updateRes.data });
}
