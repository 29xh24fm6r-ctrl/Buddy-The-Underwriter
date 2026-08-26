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

  // SPEC-08: return canonical row so consumers can reconcile without
  // a hard refresh.
  const up = await (sb as any)
    .from("deal_conditions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", condition_id)
    .eq("deal_id", dealId)
    .select(
      "id, deal_id, title, description, category, status, source, source_key, due_date, created_at, updated_at",
    )
    .maybeSingle();

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
          satisfied_by: actorProfileId,
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
      created_by: actorProfileId,
    });
  } catch {}

  return NextResponse.json({ ok: true, condition: up.data ?? null });
}
