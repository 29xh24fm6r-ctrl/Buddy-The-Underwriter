import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireUnderwriterOnDeal } from "@/lib/auth/requireUnderwriterOnDeal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ENTITY_SCOPED_DOC_TYPES } from "@/lib/intake/identity/entityScopedDocTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type RouteContext = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/intake/entity-slot-bindings
 *
 * Returns deal entities, entity-scoped slots, and binding state.
 * Used by the entity slot binding page to render the binding UI.
 */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { dealId } = await ctx.params;

  try {
    await requireUnderwriterOnDeal(dealId);
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();

    const [entitiesResult, slotsResult] = await Promise.all([
      (sb as any)
        .from("deal_entities")
        .select("id, name, legal_name, ein, entity_kind")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: true }),
      (sb as any)
        .from("deal_document_slots")
        .select("id, slot_key, required_doc_type, required_entity_id, sort_order")
        .eq("deal_id", dealId)
        .in("required_doc_type", [...ENTITY_SCOPED_DOC_TYPES])
        .order("sort_order", { ascending: true }),
    ]);

    if (entitiesResult.error) {
      return NextResponse.json(
        { ok: false, error: entitiesResult.error.message },
        { status: 500 },
      );
    }
    if (slotsResult.error) {
      return NextResponse.json(
        { ok: false, error: slotsResult.error.message },
        { status: 500 },
      );
    }

    const entities = entitiesResult.data ?? [];
    const slots = slotsResult.data ?? [];

    const unboundCount = slots.filter((s: any) => !s.required_entity_id).length;
    const entityBindingRequired = entities.length > 1 && unboundCount > 0;

    return NextResponse.json({
      ok: true,
      entities,
      entity_scoped_slots: slots,
      unbound_count: unboundCount,
      entity_binding_required: entityBindingRequired,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
