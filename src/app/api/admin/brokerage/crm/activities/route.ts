import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KINDS = new Set(["note", "task", "call", "email", "meeting", "stage_change", "system"]);

async function gate(): Promise<{ userId: string } | NextResponse> {
  try {
    return await requireSuperAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
}

/**
 * POST /api/admin/brokerage/crm/activities — log one timeline entry.
 * Exactly one of dealId / organizationId / personId must be provided
 * (enforced again at the DB level by crm_activities_exactly_one_target).
 */
export async function POST(req: NextRequest) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;
  const { userId } = gated;

  const body = await req.json().catch(() => ({}) as any);
  const kind = typeof body?.kind === "string" ? body.kind : "note";
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ ok: false, error: "invalid kind" }, { status: 400 });
  }

  const targets = [body?.dealId, body?.organizationId, body?.personId].filter(Boolean);
  if (targets.length !== 1) {
    return NextResponse.json(
      { ok: false, error: "exactly one of dealId, organizationId, personId is required" },
      { status: 400 },
    );
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("crm_activities")
    .insert({
      bank_id: brokerageBankId,
      kind,
      title: typeof body?.title === "string" ? body.title : null,
      properties: body?.properties ?? {},
      actor_clerk_user_id: userId,
      target_deal_id: body?.dealId ?? null,
      target_organization_id: body?.organizationId ?? null,
      target_person_id: body?.personId ?? null,
      due_at: body?.dueAt ?? null,
      assigned_to_clerk_user_id: body?.assignedToClerkUserId ?? null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, activity: data });
}
