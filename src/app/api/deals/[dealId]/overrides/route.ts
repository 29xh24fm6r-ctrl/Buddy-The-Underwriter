/**
 * GET /api/deals/[dealId]/overrides - List overrides
 * POST /api/deals/[dealId]/overrides - Create override
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { writeDealEvent } from "@/lib/events/dealEvents";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data: overrides, error } = await sb
    .from("decision_overrides")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch overrides", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, overrides });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();
  const body = await req.json();

  const {
    userId,
    decision_snapshot_id,
    field_path,
    old_value,
    new_value,
    reason,
    justification,
    severity,
    requires_review,
  } = body;

  if (!field_path || old_value === undefined || new_value === undefined) {
    return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
  }

  const { data: override, error } = await sb
    .from("decision_overrides")
    .insert({
      deal_id: dealId,
      decision_snapshot_id: decision_snapshot_id || null,
      created_by_user_id: userId,
      field_path,
      old_value,
      new_value,
      reason: reason || "",
      justification: justification || "",
      severity: severity || "normal",
      requires_review: requires_review || false,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create override", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Log to deal_events
  await writeDealEvent({
    dealId,
    bankId,
    kind: "decision_override_created",
    actorUserId: userId,
    actorRole: "senior_underwriter",
    title: `Override applied: ${field_path}`,
    detail: `${old_value} → ${new_value} (${reason})`,
    payload: {
      override_id: override.id,
      field_path,
      severity,
    },
  });

  return NextResponse.json({ ok: true, override });
}
