import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireUnderwriterOnDeal } from "@/lib/auth/requireUnderwriterOnDeal";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ENTITY_KIND_FOR_DOC_TYPE } from "@/lib/intake/slots/repair/repairDecision";
import { ENTITY_SCOPED_DOC_TYPES } from "@/lib/intake/identity/entityScopedDocTypes";
import {
  computeAttributionDecision,
  type AttributionEntityInput,
  type AttributionDocumentSignal,
} from "@/lib/identity/intelligence/attributionDecision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/[dealId]/slots/attribution-suggestions
 *
 * Computes structured entity attribution suggestions for all review-required
 * entity-scoped slots. Never auto-binds. Read-only.
 *
 * Returns suggestions for banker review — HIGH confidence suggestions can be
 * confirmed via POST /identity/confirm-attribution.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await ctx.params;

  try {
    await requireUnderwriterOnDeal(dealId);
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const sb = supabaseAdmin();

    // Load entity-scoped slots that are unbound (review-required state)
    const { data: slots, error: slotsErr } = await (sb as any)
      .from("deal_document_slots")
      .select("id, slot_key, required_doc_type, required_entity_id")
      .eq("deal_id", dealId)
      .in("required_doc_type", [...ENTITY_SCOPED_DOC_TYPES])
      .is("required_entity_id", null);

    if (slotsErr) {
      return NextResponse.json(
        { ok: false, error: slotsErr.message },
        { status: 500 },
      );
    }

    if (!slots || slots.length === 0) {
      return NextResponse.json({ ok: true, suggestions: [] });
    }

    // Load deal entities with name signals
    const { data: entities, error: entErr } = await (sb as any)
      .from("deal_entities")
      .select("id, name, legal_name, ein, entity_kind")
      .eq("deal_id", dealId)
      .neq("entity_kind", "GROUP");

    if (entErr) {
      return NextResponse.json(
        { ok: false, error: entErr.message },
        { status: 500 },
      );
    }

    // Load document signals for attribution
    const { data: docs, error: docsErr } = await (sb as any)
      .from("deal_documents")
      .select("document_type, entity_name, ai_business_name, ai_borrower_name")
      .eq("deal_id", dealId)
      .in("document_type", [...ENTITY_SCOPED_DOC_TYPES]);

    if (docsErr) {
      return NextResponse.json(
        { ok: false, error: docsErr.message },
        { status: 500 },
      );
    }

    const entityList: AttributionEntityInput[] = (entities ?? []).map(
      (e: any) => ({
        id: e.id,
        name: e.name,
        legal_name: e.legal_name ?? null,
        ein: e.ein ?? null,
      }),
    );

    const docSignals: AttributionDocumentSignal[] = (docs ?? []).map(
      (d: any) => ({
        entity_name: d.entity_name ?? null,
        ai_business_name: d.ai_business_name ?? null,
        ai_borrower_name: d.ai_borrower_name ?? null,
        ein_detected: null, // EIN is transient — not persisted
      }),
    );

    const suggestions = (slots as any[]).map((slot: any) => {
      // Filter entities to those allowed for this doc type
      const allowedKinds = ENTITY_KIND_FOR_DOC_TYPE[slot.required_doc_type] ?? [];
      const relevantEntities = entityList.filter((e) => {
        const entityKind = (entities ?? []).find((en: any) => en.id === e.id)?.entity_kind;
        return entityKind && allowedKinds.includes(entityKind);
      });

      const decision = computeAttributionDecision(slot, relevantEntities, docSignals);

      return {
        slot_id: slot.id,
        slot_key: slot.slot_key,
        required_doc_type: slot.required_doc_type,
        suggestedEntityId: decision.suggestion?.suggestedEntityId ?? null,
        confidence: decision.suggestion?.confidence ?? null,
        reason: decision.suggestion?.reason ?? null,
      };
    });

    return NextResponse.json({ ok: true, suggestions });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
