import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireUnderwriterOnDeal } from "@/lib/auth/requireUnderwriterOnDeal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[dealId]/identity/confirm-attribution
 *
 * Banker confirms an entity attribution suggestion.
 * Updates deal_document_slots.required_entity_id and emits a ledger event.
 *
 * Body: { slotId: string, entityId: string }
 *
 * Idempotent: safe to repeat with same slotId + entityId.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await ctx.params;

  let userId: string | null = null;
  try {
    await requireUnderwriterOnDeal(dealId);
    const session = await auth();
    userId = session?.userId ?? null;
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { slotId?: string; entityId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { slotId, entityId } = body;
  if (!slotId || !entityId) {
    return NextResponse.json(
      { ok: false, error: "slotId and entityId are required" },
      { status: 400 },
    );
  }

  try {
    const sb = supabaseAdmin();

    // Phase U: Load slot and check status before allowing entity binding
    const { data: slot } = await (sb as any)
      .from("deal_document_slots")
      .select("id, status")
      .eq("id", slotId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (!slot) {
      return NextResponse.json(
        { ok: false, error: "slot_not_found" },
        { status: 404 },
      );
    }

    if (slot.status !== "empty") {
      return NextResponse.json(
        {
          ok: false,
          error: "slot_not_rebindable_attached",
          detail: `Slot has status '${slot.status}' — detach first to rebind`,
        },
        { status: 409 },
      );
    }

    const { error: updateErr } = await (sb as any)
      .from("deal_document_slots")
      .update({ required_entity_id: entityId })
      .eq("id", slotId)
      .eq("deal_id", dealId);

    if (updateErr) {
      return NextResponse.json(
        { ok: false, error: updateErr.message },
        { status: 500 },
      );
    }

    writeEvent({
      dealId,
      kind: "slot.entity_manual_confirm",
      scope: "slots",
      meta: {
        slot_id: slotId,
        entity_id: entityId,
        confirmed_by_user_id: userId,
      },
    }).catch(() => {});

    // Phase U: propagate — entity binding change may affect readiness
    try {
      const { recomputeDealReady } = await import("@/lib/deals/readiness");
      await recomputeDealReady(dealId);
    } catch {}

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
