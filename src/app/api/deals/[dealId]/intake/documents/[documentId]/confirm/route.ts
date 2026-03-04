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
import { deriveBand } from "@/lib/classification/calibrateConfidence";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitPipelineEvent } from "@/lib/pulseMcp/emitPipelineEvent";
import { resolveChecklistKey } from "@/lib/docTyping/resolveChecklistKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = {
  params: Promise<{ dealId: string; documentId: string }>;
};

// checklist_key is DERIVED internally — never accepted from client input.
// Same invariant as checklist-key route (Phase F hardening).
const BodySchema = z.object({
  canonical_type: z.string().trim().min(1).optional(),
  document_type: z.string().trim().min(1).optional(),
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

    // ── Phase N: Idempotency guard ───────────────────────────────────
    // If doc is already USER_CONFIRMED and the requested fields match
    // current state, return noop — no duplicate events, no re-stamping.
    const alreadyConfirmed = (doc as any).intake_status === "USER_CONFIRMED";
    const requestMatchesCurrent =
      (body.canonical_type === undefined || body.canonical_type === beforeState.canonical_type) &&
      (body.document_type === undefined || body.document_type === beforeState.document_type) &&
      (body.tax_year === undefined || body.tax_year === beforeState.doc_year);

    if (alreadyConfirmed && requestMatchesCurrent) {
      return NextResponse.json({
        ok: true,
        documentId,
        corrected: false,
        intake_status: "USER_CONFIRMED",
        noop: true,
      });
    }

    // Phase E1.1: Pre-compute whether this is a correction or confirmation-only
    // "manual" = banker changed type/year (correction)
    // "manual_confirmed" = banker accepted AI classification as-is (confirmation)
    const willCorrect =
      (body.canonical_type !== undefined && body.canonical_type !== beforeState.canonical_type) ||
      (body.document_type !== undefined && body.document_type !== beforeState.document_type) ||
      (body.tax_year !== undefined && body.tax_year !== beforeState.doc_year);

    // ── Phase M: Derive checklist_key server-side ────────────────────
    // checklist_key is NEVER accepted from client input.
    // Derive deterministically from canonical_type + tax_year.
    const effectiveCanonicalType = body.canonical_type ?? beforeState.canonical_type;
    const effectiveTaxYear = body.tax_year ?? beforeState.doc_year;
    let derivedChecklistKey: string | null = null;

    if (effectiveCanonicalType) {
      derivedChecklistKey = resolveChecklistKey(effectiveCanonicalType, effectiveTaxYear);

      // Fail closed: if canonical_type requires a key but derivation fails
      // (e.g., tax return without year), return actionable 400 instead of 500
      const REQUIRES_KEY = new Set([
        "PERSONAL_FINANCIAL_STATEMENT",
        "BUSINESS_TAX_RETURN",
        "PERSONAL_TAX_RETURN",
        "BALANCE_SHEET",
        "INCOME_STATEMENT",
      ]);
      if (REQUIRES_KEY.has(effectiveCanonicalType) && !derivedChecklistKey) {
        return NextResponse.json(
          {
            ok: false,
            error: "invalid_checklist_derivation",
            detail: `${effectiveCanonicalType} requires a tax_year to derive checklist_key`,
          },
          { status: 400 },
        );
      }
    }

    // Build patch — order matters: derivation BEFORE finalize stamps
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      intake_status: "USER_CONFIRMED",
      intake_confirmed_at: now,
      intake_confirmed_by: access.userId,
      match_source: willCorrect ? "manual" : "manual_confirmed",
    };

    if (body.canonical_type !== undefined) {
      patch.canonical_type = body.canonical_type;
      // Auto-sync document_type unless caller explicitly overrides it.
      if (body.document_type === undefined) {
        patch.document_type = body.canonical_type;
      }
    }
    if (body.document_type !== undefined) patch.document_type = body.document_type;
    if (body.tax_year !== undefined) {
      patch.doc_year = body.tax_year;
      patch.doc_years = [body.tax_year];
    }
    if (body.period_end !== undefined) patch.period_end = body.period_end;

    // Phase M: Stamp derived checklist_key (always — even if canonical_type unchanged,
    // the existing key may be stale from a pre-hardening write)
    patch.checklist_key = derivedChecklistKey;

    // FIX 1A: Human confirmation = quality gate passed.
    // Finalize stamps AFTER checklist_key derivation is set.
    patch.quality_status = "PASSED";
    patch.finalized_at = now;

    // ── Phase M-D: Use atomic RPC when canonical_type changes ────────
    // Same pattern as checklist-key route: single transaction for
    // canonical_type → checklist_key → reconcile.
    if (body.canonical_type !== undefined && body.canonical_type !== beforeState.canonical_type) {
      // Set doc_year + metadata first (RPC only handles type + key + reconcile)
      if (body.tax_year !== undefined) {
        await (sb as any)
          .from("deal_documents")
          .update({
            doc_year: body.tax_year,
            doc_years: [body.tax_year],
          } as any)
          .eq("id", documentId)
          .eq("deal_id", dealId);
      }

      const rpcRes = await sb.rpc("atomic_retype_document", {
        p_document_id: documentId,
        p_new_canonical_type: body.canonical_type,
      });

      if (rpcRes.error) {
        return NextResponse.json(
          { ok: false, error: "update_failed", detail: rpcRes.error.message },
          { status: 500 },
        );
      }

      // Stamp remaining metadata that the RPC doesn't handle
      const { error: metaErr } = await (sb as any)
        .from("deal_documents")
        .update({
          intake_status: "USER_CONFIRMED",
          intake_confirmed_at: now,
          intake_confirmed_by: access.userId,
          match_source: willCorrect ? "manual" : "manual_confirmed",
          quality_status: "PASSED",
          finalized_at: now,
          ...(body.period_end !== undefined ? { period_end: body.period_end } : {}),
        } as any)
        .eq("id", documentId)
        .eq("deal_id", dealId);

      if (metaErr) {
        return NextResponse.json(
          { ok: false, error: "update_failed", detail: metaErr.message },
          { status: 500 },
        );
      }
    } else {
      // No canonical_type change — safe to do a single UPDATE with full patch
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
    }

    // ── Checklist truth: materialize corrected classification immediately ──
    // Manual corrections update deal_documents but don't automatically propagate
    // to deal_checklist_items. Reconcile now so the intake review UI and cockpit
    // readiness panel reflect the corrected doc type without waiting for async processing.
    const reconcileStartMs = Date.now();
    try {
      const { reconcileChecklistForDeal } = await import("@/lib/checklist/engine");
      const r = await reconcileChecklistForDeal({ sb, dealId });
      const durationMs = Date.now() - reconcileStartMs;

      void writeEvent({
        dealId,
        kind: "checklist.reconciled",
        scope: "checklist",
        actorUserId: access.userId,
        meta: {
          trigger: "intake_doc_confirm",
          route: "/api/deals/[dealId]/intake/documents/[documentId]/confirm",
          document_id: documentId,
          duration_ms: durationMs,
          updated: (r as any)?.updated ?? null,
          note: "non_blocking",
        },
      });

      void logLedgerEvent({
        dealId,
        bankId: access.bankId ?? "",
        eventKey: "deal.checklist.reconciled",
        uiState: "done",
        uiMessage: "Checklist reconciled (intake doc confirm)",
        meta: { trigger: "intake_doc_confirm", document_id: documentId, duration_ms: durationMs, updated: (r as any)?.updated ?? null },
      });

      void emitPipelineEvent({
        kind: "checklist_reconciled",
        deal_id: dealId,
        bank_id: access.bankId,
        payload: { trigger: "intake_doc_confirm", document_id: documentId, duration_ms: durationMs, updated: (r as any)?.updated ?? null },
      });
    } catch (reconcileErr: any) {
      // Non-blocking — reconciliation failure must not block document confirmation
      console.error("[intake/doc/confirm] checklist reconcile failed:", (reconcileErr as any)?.message);
    }

    // Emit finalization event (FIX 1A)
    void writeEvent({
      dealId,
      kind: "intake.document_finalized",
      actorUserId: access.userId,
      scope: "intake",
      meta: {
        document_id: documentId,
        finalized_at: now,
        quality_status: "PASSED",
        intake_confirmation_version: INTAKE_CONFIRMATION_VERSION,
      },
    });

    // Determine if anything was corrected
    const afterState = {
      canonical_type: body.canonical_type ?? beforeState.canonical_type,
      document_type: body.document_type ?? body.canonical_type ?? beforeState.document_type,
      checklist_key: derivedChecklistKey ?? beforeState.checklist_key,
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

    // Override Intelligence: emit classification.manual_override when type or year changed
    // Feeds into override_clusters_v1, override_drift_v1, drift detection, golden corpus
    const typeOverride = hasDelta && afterState.canonical_type !== beforeState.canonical_type;
    const yearOverride = hasDelta && afterState.doc_year !== beforeState.doc_year;
    if (typeOverride || yearOverride) {
      const rawConfidence: number | null = (doc as any).ai_confidence ?? (doc as any).classification_confidence ?? null;
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
          original_year: beforeState.doc_year ?? null,
          confirmed_year: afterState.doc_year ?? null,
          classified_by: access.userId,
          // Override Intelligence enrichment (Phase B)
          confidence_at_time: rawConfidence,
          confidence_band: deriveBand(rawConfidence ?? 0),
          classifier_source: (doc as any).match_source ?? null,
          classification_tier: (doc as any).classification_tier ?? null,
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
