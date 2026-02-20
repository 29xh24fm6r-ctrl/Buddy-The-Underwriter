import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { isIntakeConfirmationGateEnabled } from "@/lib/flags/intakeConfirmationGate";
import { INTAKE_CONFIRMATION_VERSION } from "@/lib/intake/confirmation/types";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { SEGMENTATION_VERSION } from "@/lib/intake/segmentation/types";
import { extractFilenamePattern } from "@/lib/intake/overrideIntelligence/extractFilenamePattern";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = {
  params: Promise<{ dealId: string; documentId: string }>;
};

const BodySchema = z.object({
  canonical_type: z.string().trim().min(1).optional(),
  document_type: z.string().trim().min(1).optional(),
  checklist_key: z.string().trim().min(1).optional(),
  tax_year: z.number().int().min(1990).max(2100).optional(),
  period_end: z.string().trim().min(1).optional(),
});

/**
 * POST /api/deals/[dealId]/intake/documents/[documentId]/confirm
 *
 * Correct and/or confirm a single document during intake review.
 * Guards: feature enabled, deal not already locked.
 * Emits intake.document_corrected (with delta) or intake.document_confirmed (no change).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { dealId, documentId } = await ctx.params;

    if (!isIntakeConfirmationGateEnabled()) {
      return NextResponse.json(
        { ok: false, error: "intake_confirmation_gate_disabled" },
        { status: 400 },
      );
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status =
        access.error === "deal_not_found" ? 404 :
        access.error === "tenant_mismatch" ? 403 : 401;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    // Check deal is not already locked
    const sb = supabaseAdmin();
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("intake_phase")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    if ((deal as any).intake_phase === "CONFIRMED_READY_FOR_PROCESSING") {
      return NextResponse.json(
        { ok: false, error: "intake_already_locked" },
        { status: 409 },
      );
    }

    // Parse body
    let body: z.infer<typeof BodySchema>;
    try {
      body = BodySchema.parse(await req.json());
    } catch {
      return NextResponse.json(
        { ok: false, error: "invalid_body" },
        { status: 400 },
      );
    }

    // Load current document state (before)
    const { data: doc, error: docErr } = await sb
      .from("deal_documents")
      .select(
        `id, canonical_type, document_type, checklist_key, doc_year,
         ai_confidence, classification_tier, intake_status,
         original_filename, match_source, classification_version, gatekeeper_route`,
      )
      .eq("id", documentId)
      .eq("deal_id", dealId)
      .maybeSingle();

    if (docErr || !doc) {
      return NextResponse.json(
        { ok: false, error: "document_not_found" },
        { status: 404 },
      );
    }

    // Defense-in-depth: reject mutations on locked documents
    if ((doc as any).intake_status === "LOCKED_FOR_PROCESSING") {
      void writeEvent({
        dealId,
        kind: "intake.document_mutation_blocked_locked",
        actorUserId: access.userId,
        scope: "intake",
        meta: {
          document_id: documentId,
          intake_status: "LOCKED_FOR_PROCESSING",
          intake_confirmation_version: INTAKE_CONFIRMATION_VERSION,
        },
      });
      return NextResponse.json(
        { ok: false, error: "document_locked_for_processing" },
        { status: 409 },
      );
    }

    const beforeState = {
      canonical_type: (doc as any).canonical_type,
      document_type: (doc as any).document_type,
      checklist_key: (doc as any).checklist_key,
      doc_year: (doc as any).doc_year,
    };

    // Build patch
    const patch: Record<string, unknown> = {
      intake_status: "USER_CONFIRMED",
      intake_confirmed_at: new Date().toISOString(),
      intake_confirmed_by: access.userId,
    };

    if (body.canonical_type !== undefined) patch.canonical_type = body.canonical_type;
    if (body.document_type !== undefined) patch.document_type = body.document_type;
    if (body.checklist_key !== undefined) patch.checklist_key = body.checklist_key;
    if (body.tax_year !== undefined) {
      patch.doc_year = body.tax_year;
      patch.doc_years = [body.tax_year];
    }
    if (body.period_end !== undefined) patch.period_end = body.period_end;

    // Apply patch
    const { error: updErr } = await (sb as any)
      .from("deal_documents")
      .update(patch)
      .eq("id", documentId)
      .eq("deal_id", dealId);

    if (updErr) {
      return NextResponse.json(
        { ok: false, error: "update_failed", detail: updErr.message },
        { status: 500 },
      );
    }

    // Determine if anything was corrected
    const afterState = {
      canonical_type: body.canonical_type ?? beforeState.canonical_type,
      document_type: body.document_type ?? beforeState.document_type,
      checklist_key: body.checklist_key ?? beforeState.checklist_key,
      doc_year: body.tax_year ?? beforeState.doc_year,
    };

    const hasDelta =
      afterState.canonical_type !== beforeState.canonical_type ||
      afterState.document_type !== beforeState.document_type ||
      afterState.checklist_key !== beforeState.checklist_key ||
      afterState.doc_year !== beforeState.doc_year;

    // Emit intake event
    void writeEvent({
      dealId,
      kind: hasDelta
        ? "intake.document_corrected"
        : "intake.document_confirmed",
      actorUserId: access.userId,
      scope: "intake",
      meta: {
        document_id: documentId,
        before: beforeState,
        after: afterState,
        confidence_at_time: (doc as any).ai_confidence ?? null,
        classification_tier: (doc as any).classification_tier ?? null,
        corrected_by: access.userId,
        intake_confirmation_version: INTAKE_CONFIRMATION_VERSION,
      },
    });

    // Override Intelligence: emit classification.manual_override when canonical_type changed
    // Feeds into override_clusters_v1, override_drift_v1, drift detection, golden corpus
    if (hasDelta && afterState.canonical_type !== beforeState.canonical_type) {
      void writeEvent({
        dealId,
        kind: "classification.manual_override",
        actorUserId: access.userId,
        scope: "classification",
        action: "manual_override",
        confidence: 1.0,
        meta: {
          document_id: documentId,
          original_type: beforeState.canonical_type,
          corrected_type: afterState.canonical_type,
          classified_by: access.userId,
          // Override Intelligence enrichment (Phase B)
          confidence_at_time: (doc as any).ai_confidence ?? null,
          classifier_source: (doc as any).match_source ?? null,
          classification_version: (doc as any).classification_version ?? null,
          filename_pattern: extractFilenamePattern((doc as any).original_filename),
          match_result_state: (doc as any).gatekeeper_route ?? null,
          segmentation_version: SEGMENTATION_VERSION,
          source: "intake_review_table",
        },
      });
    }

    return NextResponse.json({
      ok: true,
      documentId,
      corrected: hasDelta,
      intake_status: "USER_CONFIRMED",
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[intake/documents/confirm]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
