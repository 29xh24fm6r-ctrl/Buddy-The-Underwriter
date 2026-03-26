import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { promoteToGuarantor, linkDocumentToEntity } from "@/lib/builder/participation/manageParticipation";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; entityId: string }> };

/**
 * PATCH /api/deals/[dealId]/builder/entities/[entityId]
 * Update participation fields.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { dealId, entityId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const sb = supabaseAdmin();

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.ownershipPct != null) update.ownership_pct = body.ownershipPct;
  if (body.title != null) update.title = body.title;
  if (body.completed != null) update.completed = body.completed;
  if (body.guarantyType != null) update.guaranty_type = body.guarantyType;
  if (body.guarantyAmount != null) update.guaranty_amount = body.guarantyAmount;
  if (body.participationData != null) update.participation_data = body.participationData;

  const { error } = await sb
    .from("deal_entity_participations")
    .update(update)
    .eq("id", entityId)
    .eq("deal_id", dealId);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * POST /api/deals/[dealId]/builder/entities/[entityId]
 * Actions: promote-to-guarantor, link-document
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId, entityId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  try {
    if (action === "promote_to_guarantor") {
      if (!body.guarantyType) return NextResponse.json({ ok: false, error: "guarantyType required" }, { status: 400 });
      const result = await promoteToGuarantor({
        dealId,
        participationId: entityId,
        guarantyType: body.guarantyType,
        guarantyAmount: body.guarantyAmount,
        bankId: auth.bankId,
        actorUserId: auth.userId,
      });
      return NextResponse.json(result);
    }

    if (action === "link_document") {
      if (!body.documentId) return NextResponse.json({ ok: false, error: "documentId required" }, { status: 400 });
      const result = await linkDocumentToEntity({
        dealId,
        participationId: entityId,
        documentId: body.documentId,
        docPurpose: body.docPurpose,
        bankId: auth.bankId,
        actorUserId: auth.userId,
      });
      return NextResponse.json(result);
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "Failed" }, { status: 500 });
  }
}
