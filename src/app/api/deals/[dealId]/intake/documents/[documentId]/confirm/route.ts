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
import { resolveChecklistKey, PERIOD_REQUIRED_TYPES } from "@/lib/docTyping/resolveChecklistKey";

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
  statement_period: z.enum(["YTD", "ANNUAL", "CURRENT", "HISTORICAL"]).optional(),
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
         original_filename, match_source, classification_version, gatekeeper_route,
         statement_period`,
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
      statement_period: (doc as any).statement_period ?? null,
    };

    // ── Phase N: Idempotency guard ───────────────────────────────────
    // If doc is already USER_CONFIRMED and the requested fields match
    // current state, return noop — no duplicate events, no re-stamping.
    const alreadyConfirmed = (doc as any).intake_status === "USER_CONFIRMED";
    const requestMatchesCurrent =
      (body.canonical_type === undefined || body.canonical_type === beforeState.canonical_type) &&
      (body.document_type === undefined || body.document_type === beforeState.document_type) &&
      (body.tax_year === undefined || body.tax_year === beforeState.doc_year) &&
      (body.statement_period === undefined || body.statement_period === beforeState.statement_period);

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
    // "manual" = banker changed type/year/period (correction)
    // "manual_confirmed" = banker accepted AI classification as-is (confirmation)
    const willCorrect =
      (body.canonical_type !== undefined && body.canonical_type !== beforeState.canonical_type) ||
      (body.document_type !== undefined && body.document_type !== beforeState.document_type) ||
      (body.tax_year !== undefined && body.tax_year !== beforeState.doc_year) ||
      (body.statement_period !== undefined && body.statement_period !== beforeState.statement_period);

    // ── Phase M+P: Derive checklist_key server-side ──────────────────
    // checklist_key is NEVER accepted from client input.
    // Derive deterministically from canonical_type + tax_year + statement_period.
    const effectiveCanonicalType = body.canonical_type ?? beforeState.canonical_type;
    const effectiveTaxYear = body.tax_year ?? beforeState.doc_year;
    const effectiveStatementPeriod = body.statement_period ?? beforeState.statement_period;
    let derivedChecklistKey: string | null = null;

    if (effectiveCanonicalType) {
      derivedChecklistKey = resolveChecklistKey(effectiveCanonicalType, effectiveTaxYear, effectiveStatementPeriod);

      // Fail closed: if canonical_type requires a key but derivation fails
      // (e.g., tax return without year, financial statement without period),
      // return actionable 400 instead of 500
      const REQUIRES_KEY = new Set([
        "PERSONAL_FINANCIAL_STATEMENT",
        "BUSINESS_TAX_RETURN",
        "PERSONAL_TAX_RETURN",
        "BALANCE_SHEET",
        "INCOME_STATEMENT",
      ]);
      if (REQUIRES_KEY.has(effectiveCanonicalType) && !derivedChecklistKey) {
        const missingField = PERIOD_REQUIRED_TYPES.has(effectiveCanonicalType)
          ? "statement_period"
          : "tax_year";
        return NextResponse.json(
          {
            ok: false,
            error: "invalid_checklist_derivation",
            detail: `${effectiveCanonicalType} requires ${missingField} to derive checklist_key`,
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
    if (body.statement_period !== undefined) patch.statement_period = body.statement_period;

    // Phase M: Stamp derived checklist_key (always — even if canonical_type unchanged,
    // the existing key may be stale from a pre-hardening write)
    patch.checklist_key = derivedChecklistKey;

    // NOTE: finalized_at + quality_status are NOT stamped here.
    // They are written in a SEPARATE update AFTER reconcile, so the DB
    // constraint finalized_doc_must_have_checklist_key is never violated.

    // ── Phase M-D: Use atomic RPC when canonical_type changes ────────
    // Same pattern as checklist-key route: single transaction for
    // canonical_type → checklist_key → reconcile.
    if (body.canonical_type !== undefined && body.canonical_type !== beforeState.canonical_type) {
      // Set doc_year + statement_period + metadata first (RPC only handles type + key + reconcile)
      const preRpcPatch: Record<string, unknown> = {};
      if (body.tax_year !== undefined) {
        preRpcPatch.doc_year = body.tax_year;
        preRpcPatch.doc_years = [body.tax_year];
      }
      if (body.statement_period !== undefined) {
        preRpcPatch.statement_period = body.statement_period;
      }
      if (Object.keys(preRpcPatch).length > 0) {
        await (sb as any)
          .from("deal_documents")
          .update(preRpcPatch as any)
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
          ...(body.period_end !== undefined ? { period_end: body.period_end } : {}),
          ...(body.statement_period !== undefined ? { statement_period: body.statement_period } : {}),
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

    // ── Finalization: separate write AFTER checklist_key persisted ─────────
    // The DB constraint finalized_doc_must_have_checklist_key requires
    // checklist_key IS NOT NULL when finalized_at IS NOT NULL.
    // Writing finalized_at as a separate step AFTER checklist_key is persisted
    // (via main patch or RPC) and reconcile has run satisfies this invariant.
    {
      // Re-read to confirm checklist_key was persisted
      const { data: freshDoc } = await (sb as any)
        .from("deal_documents")
        .select("checklist_key")
        .eq("id", documentId)
        .eq("deal_id", dealId)
        .maybeSingle();

      if (!freshDoc?.checklist_key) {
        // Fail closed — do NOT set finalized_at without checklist_key
        void writeEvent({
          dealId,
          kind: "intake.finalization_blocked_missing_key",
          actorUserId: access.userId,
          scope: "intake",
          meta: {
            document_id: documentId,
            canonical_type: effectiveCanonicalType,
            derived_checklist_key: derivedChecklistKey,
            reason: "checklist_key_null_after_persist",
            intake_confirmation_version: INTAKE_CONFIRMATION_VERSION,
          },
        });
        return NextResponse.json(
          {
            ok: false,
            error: "finalization_blocked",
            detail:
              "checklist_key is null after persist — cannot finalize (constraint: finalized_doc_must_have_checklist_key)",
          },
          { status: 500 },
        );
      }

      const { error: finalizeErr } = await (sb as any)
        .from("deal_documents")
        .update({
          quality_status: "PASSED",
          finalized_at: now,
        } as any)
        .eq("id", documentId)
        .eq("deal_id", dealId);

      if (finalizeErr) {
        return NextResponse.json(
          { ok: false, error: "finalization_failed", detail: finalizeErr.message },
          { status: 500 },
        );
      }
    }

    // ── Slot matching: attach confirmed doc to its slot ────────────────
    // Non-fatal: matching must not block confirmation.
    // Mirrors checklist-key route behavior (single source of truth for slot routing).
    if (effectiveCanonicalType) {
      try {
        const { runMatchForDocument } = await import(
          "@/lib/intake/matching/runMatch"
        );

        await runMatchForDocument({
          dealId,
          bankId: access.bankId ?? "",
          documentId,
          spine: null, // no spine classification here; human-confirmed
          gatekeeper: {
            docType: effectiveCanonicalType,
            effectiveDocType: effectiveCanonicalType,
            confidence: 1.0,
            taxYear: effectiveTaxYear ?? null,
            formNumbers: [],
          },
          matchSource: "manual",
        });

        void writeEvent({
          dealId,
          kind: "intake.document_matched_after_confirm",
          actorUserId: access.userId,
          scope: "intake",
          meta: {
            document_id: documentId,
            canonical_type: effectiveCanonicalType,
            doc_year: effectiveTaxYear ?? null,
            statement_period: effectiveStatementPeriod ?? null,
            match_source: willCorrect ? "manual" : "manual_confirmed",
          },
        });
      } catch (e: any) {
        console.warn("[intake/doc/confirm] runMatchForDocument failed (non-fatal)", {
          dealId,
          documentId,
          error: e?.message ?? String(e),
        });

        void writeEvent({
          dealId,
          kind: "intake.document_match_after_confirm_failed",
          actorUserId: access.userId,
          scope: "intake",
          meta: {
            document_id: documentId,
            canonical_type: effectiveCanonicalType,
            doc_year: effectiveTaxYear ?? null,
            statement_period: effectiveStatementPeriod ?? null,
            error: e?.message ?? String(e),
          },
        });
      }
    }

    // Emit finalization event — AFTER finalized_at is successfully persisted
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
      statement_period: body.statement_period ?? beforeState.statement_period,
    };

    const hasDelta =
      afterState.canonical_type !== beforeState.canonical_type ||
      afterState.document_type !== beforeState.document_type ||
      afterState.checklist_key !== beforeState.checklist_key ||
      afterState.doc_year !== beforeState.doc_year ||
      afterState.statement_period !== beforeState.statement_period;

    // Phase Q: Emit canonical intake event with full diff
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
        derived_checklist_key: derivedChecklistKey,
        source: "intake_review_confirm",
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
