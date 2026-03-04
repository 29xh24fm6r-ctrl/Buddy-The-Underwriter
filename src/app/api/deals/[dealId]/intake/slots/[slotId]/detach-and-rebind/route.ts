import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireUnderwriterOnDeal } from "@/lib/auth/requireUnderwriterOnDeal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ dealId: string; slotId: string }>;
};

/**
 * POST /api/deals/[dealId]/intake/slots/[slotId]/detach-and-rebind
 *
 * Phase U: Atomic detach-and-rebind for entity-scoped slots.
 * If the slot is currently attached/validated/completed, the RPC atomically:
 *   1. Deactivates attachments
 *   2. Resets slot to empty
 *   3. Updates required_entity_id
 *   4. Emits ledger events (slot.detached_for_rebind + slot.entity_rebound)
 *   5. Enqueues propagation outbox event
 *
 * Body: { new_entity_id: string }
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext,
): Promise<NextResponse> {
  const { dealId, slotId } = await ctx.params;

  let userId: string | null = null;
  try {
    await requireUnderwriterOnDeal(dealId);
    const session = await auth();
    userId = session?.userId ?? null;
  } catch {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  let body: { new_entity_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_body" },
      { status: 400 },
    );
  }

  const { new_entity_id } = body;
  if (!new_entity_id) {
    return NextResponse.json(
      { ok: false, error: "new_entity_id is required" },
      { status: 400 },
    );
  }

  try {
    const sb = supabaseAdmin();

    // Validate entity belongs to this deal
    const { data: entity } = await (sb as any)
      .from("deal_entities")
      .select("id")
      .eq("id", new_entity_id)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (!entity) {
      return NextResponse.json(
        { ok: false, error: "entity_not_found_on_deal" },
        { status: 400 },
      );
    }

    // Call atomic RPC
    const { data, error } = await sb.rpc("intake_detach_and_rebind_slot", {
      p_deal_id: dealId,
      p_slot_id: slotId,
      p_new_entity_id: new_entity_id,
    });

    if (error) {
      // Surface slot_not_found as 404
      if (error.message?.includes("slot_not_found")) {
        return NextResponse.json(
          { ok: false, error: "slot_not_found" },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    const result = data as any;

    // Application-layer ledger event (supplements the RPC-level deal_events)
    writeEvent({
      dealId,
      kind: "slot.entity_rebound",
      scope: "slots",
      meta: {
        slot_id: slotId,
        prev_entity_id: result?.prev_entity_id,
        new_entity_id,
        prev_document_id: result?.prev_document_id,
        was_detached: result?.was_detached,
        rebound_by_user_id: userId,
      },
    }).catch(() => {});

    // Propagate: readiness recompute
    try {
      const { recomputeDealReady } = await import("@/lib/deals/readiness");
      await recomputeDealReady(dealId);
    } catch {}

    return NextResponse.json({
      ok: true,
      slot_id: slotId,
      prev_entity_id: result?.prev_entity_id,
      new_entity_id,
      prev_document_id: result?.prev_document_id,
      was_detached: result?.was_detached,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
