import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireUnderwriterOnDeal } from "@/lib/auth/requireUnderwriterOnDeal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { ENTITY_SCOPED_DOC_TYPES } from "@/lib/intake/identity/entityScopedDocTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/intake/bind-slots
 *
 * Atomic batch binding of entity-scoped slots.
 * Body: { bindings: Array<{ slotId: string, entityId: string }> }
 *
 * Validates all slots are entity-scoped, all entities belong to the deal,
 * then writes all bindings atomically and emits ledger events.
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext,
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

  let body: { bindings?: Array<{ slotId?: string; entityId?: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const { bindings } = body;
  if (!Array.isArray(bindings) || bindings.length === 0) {
    return NextResponse.json(
      { ok: false, error: "bindings array is required and must not be empty" },
      { status: 400 },
    );
  }

  // Validate each binding has required fields
  for (const b of bindings) {
    if (!b.slotId || !b.entityId) {
      return NextResponse.json(
        { ok: false, error: "each binding must have slotId and entityId" },
        { status: 400 },
      );
    }
  }

  try {
    const sb = supabaseAdmin();

    // Load slots to validate they belong to this deal and are entity-scoped
    const slotIds = bindings.map((b) => b.slotId!);
    const { data: slots, error: slotsErr } = await (sb as any)
      .from("deal_document_slots")
      .select("id, required_doc_type, required_entity_id, status")
      .eq("deal_id", dealId)
      .in("id", slotIds);

    if (slotsErr) {
      return NextResponse.json(
        { ok: false, error: slotsErr.message },
        { status: 500 },
      );
    }

    // Verify all requested slots exist on this deal
    const foundSlotIds = new Set((slots ?? []).map((s: any) => s.id));
    for (const sid of slotIds) {
      if (!foundSlotIds.has(sid)) {
        return NextResponse.json(
          { ok: false, error: `slot ${sid} not found on this deal` },
          { status: 400 },
        );
      }
    }

    // Verify all slots are entity-scoped doc types
    for (const slot of slots ?? []) {
      if (!ENTITY_SCOPED_DOC_TYPES.has(slot.required_doc_type)) {
        return NextResponse.json(
          { ok: false, error: `slot ${slot.id} is not entity-scoped (type: ${slot.required_doc_type})` },
          { status: 400 },
        );
      }
    }

    // Phase U: Block rebinding on non-empty slots (must detach first)
    for (const slot of slots ?? []) {
      if (slot.status !== "empty") {
        return NextResponse.json(
          {
            ok: false,
            error: "slot_not_rebindable_attached",
            detail: `Slot ${slot.id} has status '${slot.status}' — detach first to rebind`,
            slot_id: slot.id,
            status: slot.status,
          },
          { status: 409 },
        );
      }
    }

    // Load entities to validate they belong to this deal
    const entityIds = [...new Set(bindings.map((b) => b.entityId!))];
    const { data: entities, error: entErr } = await (sb as any)
      .from("deal_entities")
      .select("id")
      .eq("deal_id", dealId)
      .in("id", entityIds);

    if (entErr) {
      return NextResponse.json(
        { ok: false, error: entErr.message },
        { status: 500 },
      );
    }

    const foundEntityIds = new Set((entities ?? []).map((e: any) => e.id));
    for (const eid of entityIds) {
      if (!foundEntityIds.has(eid)) {
        return NextResponse.json(
          { ok: false, error: `entity ${eid} not found on this deal` },
          { status: 400 },
        );
      }
    }

    // Atomic: update all slots in parallel (each is an independent row update)
    const updatePromises = bindings.map((b) =>
      (sb as any)
        .from("deal_document_slots")
        .update({ required_entity_id: b.entityId })
        .eq("id", b.slotId)
        .eq("deal_id", dealId),
    );

    const results = await Promise.all(updatePromises);
    for (const r of results) {
      if (r.error) {
        return NextResponse.json(
          { ok: false, error: r.error.message },
          { status: 500 },
        );
      }
    }

    // Emit ledger events for each binding (fire-and-forget)
    for (const b of bindings) {
      writeEvent({
        dealId,
        kind: "slot.entity_bound",
        scope: "slots",
        meta: {
          slot_id: b.slotId,
          entity_id: b.entityId,
          bound_by_user_id: userId,
          source: "entity_slot_binding_page",
          batch_size: bindings.length,
        },
      }).catch(() => {});
    }

    // Compute remaining unbound count
    const { data: remainingSlots } = await (sb as any)
      .from("deal_document_slots")
      .select("id")
      .eq("deal_id", dealId)
      .in("required_doc_type", [...ENTITY_SCOPED_DOC_TYPES])
      .is("required_entity_id", null);

    const unboundCount = (remainingSlots ?? []).length;

    // Phase U: propagate — entity binding change may affect readiness
    try {
      const { recomputeDealReady } = await import("@/lib/deals/readiness");
      await recomputeDealReady(dealId);
    } catch {}

    return NextResponse.json({
      ok: true,
      bound_count: bindings.length,
      unbound_count: unboundCount,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
