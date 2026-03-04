/**
 * Phase E0 — Downstream Orchestrator for Confirmed Intake
 *
 * Runs all deferred downstream operations after human confirmation:
 *   - Per-doc: matching, extraction, spread recompute
 *   - Deal-level: facts materialization, checklist reconcile, readiness, naming
 *
 * All operations are idempotent. Safe to re-run.
 * Reads CURRENT deal_documents values — user corrections are auto-picked-up.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import {
  INTAKE_CONFIRMATION_VERSION,
  INTAKE_SNAPSHOT_VERSION,
  computeIntakeSnapshotHash,
} from "@/lib/intake/confirmation/types";
import { QUALITY_VERSION } from "@/lib/intake/quality/evaluateDocumentQuality";
import { PROCESSING_VERSION, PROCESSING_OBSERVABILITY_VERSION } from "@/lib/intake/constants";
import { stampProcessingHeartbeat } from "./processingHeartbeat";
import { updateDealIfRunOwner } from "./updateDealIfRunOwner";
import { summarizeProcessingErrors } from "./summarizeProcessingError";
import { computeDealPhasePatch } from "./computeDealPhasePatch";
import type { TerminalPhase } from "./computeDealPhasePatch";

// ── Extract-eligible canonical types (mirrors processArtifact routing) ──

const EXTRACT_ELIGIBLE = new Set([
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "RENT_ROLL",
  "PERSONAL_FINANCIAL_STATEMENT",
  "PERSONAL_INCOME",
  "SCHEDULE_K1",
]);

// ── Types ──────────────────────────────────────────────────────────────

export type ProcessConfirmedResult = {
  ok: boolean;
  docsProcessed: number;
  matchResults: Array<{ documentId: string; decision: string }>;
  extractResults: Array<{ documentId: string; ok: boolean }>;
  errors: string[];
};

type ConfirmedDoc = {
  id: string;
  canonical_type: string | null;
  document_type: string | null;
  original_filename: string | null;
  ai_doc_type: string | null;
  ai_confidence: number | null;
  ai_tax_year: number | null;
  ai_form_numbers: string[] | null;
  classification_tier: string | null;
  match_source: string | null;
  gatekeeper_doc_type: string | null;
  gatekeeper_route: string | null;
  gatekeeper_confidence: number | null;
  gatekeeper_needs_review: boolean | null;
  gatekeeper_tax_year: number | null;
};

// ── Main ───────────────────────────────────────────────────────────────

export async function processConfirmedIntake(
  dealId: string,
  bankId: string,
  runId?: string,
): Promise<ProcessConfirmedResult> {
  const sb = supabaseAdmin();
  const errors: string[] = [];
  const matchResults: Array<{ documentId: string; decision: string }> = [];
  const extractResults: Array<{ documentId: string; ok: boolean }> = [];
  const startMs = Date.now();

  // ── Stamp started_at + initial heartbeat ───────────────────────────
  if (runId) {
    try {
      await (sb as any)
        .from("deals")
        .update({
          intake_processing_started_at: new Date().toISOString(),
          intake_processing_last_heartbeat_at: new Date().toISOString(),
        })
        .eq("id", dealId)
        .eq("intake_processing_run_id", runId);
    } catch {
      // Non-fatal — observability failure must not block processing
    }
  }

  // ── OUTER TRY/CATCH — GUARANTEES PHASE TRANSITION ─────────────────
  // Part 5: processConfirmedIntake MUST transition intake_phase even if
  // an unexpected error occurs. Without this, a deal stays stuck in
  // CONFIRMED_READY_FOR_PROCESSING forever (no lock TTL can help if
  // the function dies before reaching the phase-update block).
  try {

  // ── SNAPSHOT VERIFICATION (fail-closed) ─────────────────────────────
  // The execution root defends itself: recompute hash, compare to stored.
  // No downstream work executes until this block passes.

  const { data: dealRow, error: dealLoadErr } = await sb
    .from("deals")
    .select("intake_phase, intake_snapshot_hash")
    .eq("id", dealId)
    .maybeSingle();

  if (dealLoadErr || !dealRow) {
    throw new Error(`[processConfirmedIntake] deal not found: ${dealId}`);
  }

  if ((dealRow as any).intake_phase !== "CONFIRMED_READY_FOR_PROCESSING") {
    throw new Error(
      `[processConfirmedIntake] deal ${dealId} not in CONFIRMED phase (got: ${(dealRow as any).intake_phase})`,
    );
  }

  const storedHash = (dealRow as any).intake_snapshot_hash as string | null;
  if (!storedHash) {
    void writeEvent({
      dealId,
      kind: "intake.snapshot_hash_missing",
      scope: "intake",
      meta: {
        snapshot_version: INTAKE_SNAPSHOT_VERSION,
        confirmation_version: INTAKE_CONFIRMATION_VERSION,
      },
    });
    throw new Error(
      `[processConfirmedIntake] intake_snapshot_hash is null for confirmed deal ${dealId}`,
    );
  }

  // Load active docs for hash recomputation
  const { data: hashDocs, error: hashDocsErr } = await (sb as any)
    .from("deal_documents")
    .select("id, canonical_type, doc_year, logical_key")
    .eq("deal_id", dealId)
    .eq("is_active", true);

  if (hashDocsErr || !hashDocs?.length) {
    throw new Error(
      `[processConfirmedIntake] cannot load docs for hash verification: ${hashDocsErr?.message ?? "no_docs"}`,
    );
  }

  // Snapshot hash: only identity-resolved docs (matches confirm route)
  const sealableDocs = hashDocs.filter((d: any) => d.logical_key != null);
  const recomputedHash = computeIntakeSnapshotHash(
    sealableDocs.map((d: any) => ({
      id: d.id,
      canonical_type: d.canonical_type,
      doc_year: d.doc_year,
    })),
  );

  if (recomputedHash !== storedHash) {
    void writeEvent({
      dealId,
      kind: "intake.snapshot_mismatch_detected",
      scope: "intake",
      meta: {
        stored_hash: storedHash,
        recomputed_hash: recomputedHash,
        doc_count: hashDocs.length,
        snapshot_version: INTAKE_SNAPSHOT_VERSION,
        confirmation_version: INTAKE_CONFIRMATION_VERSION,
      },
    });
    throw new Error(
      `[processConfirmedIntake] snapshot mismatch for deal ${dealId} — stored: ${storedHash.slice(0, 12)}… recomputed: ${recomputedHash.slice(0, 12)}…`,
    );
  }

  // ── END SNAPSHOT VERIFICATION ───────────────────────────────────────
  if (runId) void stampProcessingHeartbeat(dealId, runId, "snapshot_verified");

  // ── QUALITY VERIFICATION (defense-in-depth, non-aborting) ────────
  // Only explicitly FAILED docs are flagged. Docs with NULL quality_status
  // (not yet evaluated) pass through — the confirmation gate already validated.
  // A single doc failure must not abort the entire processing run.
  const { data: failedQualityDocs, error: qualityCheckErr } = await (sb as any)
    .from("deal_documents")
    .select("id, quality_status")
    .eq("deal_id", dealId)
    .eq("is_active", true)
    .eq("quality_status", "FAILED");

  if (qualityCheckErr) {
    errors.push(`quality_check_query: ${qualityCheckErr.message}`);
  } else if (failedQualityDocs && failedQualityDocs.length > 0) {
    void writeEvent({
      dealId,
      kind: "intake.processing_quality_warning",
      scope: "intake",
      meta: {
        failed_count: failedQualityDocs.length,
        failed_ids: failedQualityDocs.map((d: any) => d.id),
        quality_version: QUALITY_VERSION,
      },
    });
    errors.push(
      `quality_defense: ${failedQualityDocs.length} docs have FAILED quality status`,
    );
  }
  // ── END QUALITY VERIFICATION ─────────────────────────────────────
  if (runId) void stampProcessingHeartbeat(dealId, runId, "quality_verified");

  // ── E3: SUPERSESSION DEFENSE-IN-DEPTH ──────────────────────────────

  // Guard 1: No inactive docs in LOCKED set (should be DB-impossible)
  const { data: inactiveInLocked } = await (sb as any)
    .from("deal_documents")
    .select("id")
    .eq("deal_id", dealId)
    .eq("is_active", false)
    .eq("intake_status", "LOCKED_FOR_PROCESSING");

  if (inactiveInLocked && inactiveInLocked.length > 0) {
    void writeEvent({
      dealId,
      kind: "intake.processing_blocked_duplicate_violation",
      scope: "intake",
      meta: {
        inactive_locked_ids: inactiveInLocked.map((d: any) => d.id),
        count: inactiveInLocked.length,
      },
    });
    throw new Error(
      `[processConfirmedIntake] ${inactiveInLocked.length} inactive docs in LOCKED set for deal ${dealId}`,
    );
  }

  // Guard 2: No identity-ambiguous entity-scoped duplicates in active locked set
  const { data: nullKeyLocked } = await (sb as any)
    .from("deal_documents")
    .select("id, canonical_type, doc_year")
    .eq("deal_id", dealId)
    .eq("is_active", true)
    .is("logical_key", null)
    .eq("intake_status", "LOCKED_FOR_PROCESSING")
    .in("canonical_type", [
      "PERSONAL_TAX_RETURN",
      "PERSONAL_FINANCIAL_STATEMENT",
      "BUSINESS_TAX_RETURN",
    ]);

  if (nullKeyLocked && nullKeyLocked.length > 0) {
    // Group by canonical_type + doc_year, check for duplicates
    const groups = new Map<string, number>();
    for (const d of nullKeyLocked) {
      const key = `${d.canonical_type}|${d.doc_year ?? "NA"}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const duplicateGroups = [...groups.entries()].filter(([, count]) => count > 1);

    if (duplicateGroups.length > 0) {
      void writeEvent({
        dealId,
        kind: "intake.processing_blocked_identity_ambiguity",
        scope: "intake",
        meta: {
          ambiguous_groups: duplicateGroups.map(([key, count]) => ({ key, count })),
          null_key_locked_count: nullKeyLocked.length,
        },
      });
      throw new Error(
        `[processConfirmedIntake] identity-ambiguous entity-scoped duplicates in locked set for deal ${dealId}`,
      );
    }
  }

  // ── END SUPERSESSION DEFENSE-IN-DEPTH ──────────────────────────────
  if (runId) void stampProcessingHeartbeat(dealId, runId, "supersession_checked");

  // 1. Load all active confirmed docs
  const { data: docs, error: loadErr } = await (sb as any)
    .from("deal_documents")
    .select(
      `id, canonical_type, document_type, original_filename,
       ai_doc_type, ai_confidence, ai_tax_year, ai_form_numbers,
       classification_tier, match_source,
       gatekeeper_doc_type, gatekeeper_route, gatekeeper_confidence,
       gatekeeper_needs_review, gatekeeper_tax_year`,
    )
    .eq("deal_id", dealId)
    .eq("is_active", true)
    .in("intake_status", [
      "AUTO_CONFIRMED",
      "USER_CONFIRMED",
      "LOCKED_FOR_PROCESSING",
    ]);

  if (loadErr || !docs?.length) {
    return {
      ok: false,
      docsProcessed: 0,
      matchResults: [],
      extractResults: [],
      errors: [loadErr?.message ?? "no_confirmed_docs"],
    };
  }

  const confirmedDocs = docs as ConfirmedDoc[];

  // 2. Per-doc: matching + extraction (parallelized with bounded concurrency)
  //
  // IMPORTANT: ALL docs here are confirmed (AUTO_CONFIRMED, USER_CONFIRMED,
  // or LOCKED_FOR_PROCESSING). The gatekeeper_needs_review flag is pre-confirmation
  // metadata — the banker's confirmation IS the review. Never gate on it here.
  //
  // Concurrency limit of 3 prevents overloading AI extraction services while
  // cutting total processing time from ~7 min (sequential) to ~2.5 min for 9 docs.
  const DOC_CONCURRENCY = 3;

  /** Process a single document: matching → extraction. */
  async function processOneDoc(doc: ConfirmedDoc): Promise<void> {
    const effectiveDocType =
      doc.canonical_type ?? doc.document_type ?? doc.ai_doc_type ?? "";

    // 2a. Matching
    if (effectiveDocType) {
      try {
        const { runMatchForDocument } = await import(
          "@/lib/intake/matching/runMatch"
        );

        const isManualCorrection = doc.match_source === "manual";

        // For manual corrections, discard stale AI signals — rebuild from
        // the banker-corrected canonical_type with full confidence.
        const spineSignals = isManualCorrection
          ? null
          : doc.ai_doc_type
            ? {
                docType: doc.ai_doc_type,
                confidence: doc.ai_confidence ?? 0,
                spineTier: doc.classification_tier ?? "fallback",
                taxYear: doc.ai_tax_year,
                entityType: null,
                formNumbers: doc.ai_form_numbers ?? [],
                evidence: [],
              }
            : null;

        const gkSignals = isManualCorrection
          ? {
              docType: effectiveDocType,
              confidence: 1.0,
              taxYear: doc.gatekeeper_tax_year ?? doc.ai_tax_year ?? null,
              formNumbers: [] as string[],
              effectiveDocType,
            }
          : doc.gatekeeper_doc_type
            ? {
                docType: doc.gatekeeper_doc_type,
                confidence: doc.gatekeeper_confidence ?? 0,
                taxYear: doc.gatekeeper_tax_year ?? null,
                formNumbers: [] as string[],
                effectiveDocType,
              }
            : null;

        const matchResult = await runMatchForDocument({
          dealId,
          bankId,
          documentId: doc.id,
          spine: spineSignals,
          gatekeeper: gkSignals,
          ocrText: null,
          filename: doc.original_filename ?? null,
          matchSource: isManualCorrection ? "manual" : "manual_confirmed",
        });

        matchResults.push({
          documentId: doc.id,
          decision: matchResult.decision,
        });

        // 2a-ii. Validate slot attachment after successful matching
        if (matchResult.decision === "auto_attached") {
          try {
            const { validateSlotAttachmentIfAny } = await import(
              "@/lib/intake/slots/validateSlotAttachment"
            );
            await validateSlotAttachmentIfAny({
              documentId: doc.id,
              classifiedDocType: effectiveDocType,
              classifiedTaxYear: doc.ai_tax_year ?? doc.gatekeeper_tax_year ?? null,
            });
          } catch (valErr: any) {
            console.warn(
              `[processConfirmedIntake] slot validation error for doc ${doc.id}:`,
              valErr?.message,
            );
          }
        }
      } catch (err: any) {
        errors.push(`match:${doc.id}:${err?.message}`);
      }
    }

    // 2b. Extraction
    if (effectiveDocType && EXTRACT_ELIGIBLE.has(effectiveDocType)) {
      try {
        const { extractByDocType } = await import(
          "@/lib/extract/router/extractByDocType"
        );
        await extractByDocType(doc.id);
        extractResults.push({ documentId: doc.id, ok: true });
      } catch (err: any) {
        extractResults.push({ documentId: doc.id, ok: false });
        errors.push(`extract:${doc.id}:${err?.message}`);
      }
    }
  }

  // Process docs in batches of DOC_CONCURRENCY
  for (let i = 0; i < confirmedDocs.length; i += DOC_CONCURRENCY) {
    // CAS bail-out: verify this run is still the active run before each batch
    if (runId) {
      try {
        const { data: runCheck } = await sb
          .from("deals")
          .select("intake_processing_run_id")
          .eq("id", dealId)
          .maybeSingle();
        if (runCheck && (runCheck as any).intake_processing_run_id !== runId) {
          errors.push("run_superseded_mid_processing");
          break;
        }
      } catch {
        // Non-fatal — continue processing if CAS check fails
      }
    }

    const batch = confirmedDocs.slice(i, i + DOC_CONCURRENCY);
    await Promise.allSettled(batch.map(processOneDoc));

    if (runId) void stampProcessingHeartbeat(dealId, runId, `batch_${i}`);
  }

  // ── E2: Proof-driven spread orchestration ─────────────────────────
  // Runs AFTER matching + extraction are complete for all docs.
  // Orchestrator verifies intake proof, then enqueues spreads.
  try {
    const { orchestrateSpreads } = await import(
      "@/lib/spreads/orchestrateSpreads"
    );
    const orchResult = await orchestrateSpreads(
      dealId,
      bankId,
      "intake_confirmed",
    );
    if (!orchResult.ok) {
      errors.push(
        `orchestrate:preflight_blocked:${orchResult.blockers?.length ?? 0}_blockers`,
      );
    }
  } catch (err: any) {
    errors.push(`orchestrate:${err?.message}`);
  }
  if (runId) void stampProcessingHeartbeat(dealId, runId, "spreads_orchestrated");

  // 3. Deal-level operations

  // 3a. Materialize facts
  try {
    const { materializeFactsFromArtifacts } = await import(
      "@/lib/financialFacts/materializeFactsFromArtifacts"
    );
    await materializeFactsFromArtifacts({ dealId, bankId });
  } catch (err: any) {
    errors.push(`materialize:${err?.message}`);
  }
  if (runId) void stampProcessingHeartbeat(dealId, runId, "facts_materialized");

  // 3b. Reconcile checklist
  try {
    const { reconcileChecklistForDeal } = await import(
      "@/lib/checklist/engine"
    );
    await reconcileChecklistForDeal({ sb, dealId });
  } catch (err: any) {
    errors.push(`reconcile:${err?.message}`);
  }

  // 3c. Bootstrap lifecycle
  try {
    const { bootstrapDealLifecycle } = await import(
      "@/lib/lifecycle/bootstrapDealLifecycle"
    );
    await bootstrapDealLifecycle(dealId);
  } catch {
    // Non-fatal
  }

  // 3d. Recompute readiness
  try {
    const { recomputeDealReady } = await import("@/lib/deals/readiness");
    await recomputeDealReady(dealId);
  } catch (err: any) {
    errors.push(`readiness:${err?.message}`);
  }

  // 3e. Naming derivation
  if (confirmedDocs.length > 0) {
    try {
      const { runNamingDerivation } = await import(
        "@/lib/naming/runNamingDerivation"
      );
      await runNamingDerivation({
        dealId,
        bankId,
        documentId: confirmedDocs[confirmedDocs.length - 1].id,
      });
    } catch {
      // Non-fatal
    }
  }

  // 4. Transition to PROCESSING_COMPLETE (or PROCESSING_FAILED)
  if (runId) void stampProcessingHeartbeat(dealId, runId, "completing");

  const finalPhase =
    errors.length === 0 ? "PROCESSING_COMPLETE" : "PROCESSING_COMPLETE_WITH_ERRORS";

  await transitionPhaseAndEmit(sb, dealId, finalPhase, {
    startMs,
    docsProcessed: confirmedDocs.length,
    matchCount: matchResults.length,
    extractCount: extractResults.length,
    errorCount: errors.length,
    runId,
    errors: errors.length > 0 ? errors : undefined,
  });

  return {
    ok: errors.length === 0,
    docsProcessed: confirmedDocs.length,
    matchResults,
    extractResults,
    errors,
  };

  } catch (outerErr: any) {
    // ── GUARANTEED PHASE TRANSITION (Part 5) ──────────────────────────
    // Even if snapshot verification, quality gate, or any processing step
    // throws, we MUST transition the deal out of CONFIRMED_READY_FOR_PROCESSING
    // so the UI doesn't stay stuck forever.
    console.error("[processConfirmedIntake] outer catch — guaranteeing phase transition", {
      dealId,
      error: outerErr?.message,
    });

    errors.push(`fatal:${outerErr?.message}`);

    await transitionPhaseAndEmit(sb, dealId, "PROCESSING_COMPLETE_WITH_ERRORS", {
      startMs,
      docsProcessed: 0,
      matchCount: matchResults.length,
      extractCount: extractResults.length,
      errorCount: errors.length,
      fatal: true,
      runId,
      errors,
    });

    return {
      ok: false,
      docsProcessed: 0,
      matchResults,
      extractResults,
      errors,
    };
  }
}

// ── Phase transition + completion event helper ─────────────────────────

async function transitionPhaseAndEmit(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  finalPhase: string,
  opts: {
    startMs: number;
    docsProcessed: number;
    matchCount: number;
    extractCount: number;
    errorCount: number;
    fatal?: boolean;
    runId?: string;
    errors?: string[];
  },
): Promise<void> {
  const durationMs = Date.now() - opts.startMs;

  // Build PII-safe error summary for the observability column
  const errorSummary =
    opts.errors && opts.errors.length > 0
      ? summarizeProcessingErrors(opts.errors)
      : null;

  try {
    const updatePayload = computeDealPhasePatch(finalPhase as TerminalPhase, {
      errorSummary,
    });
    const updated = await updateDealIfRunOwner(dealId, opts.runId, updatePayload);
    if (!updated) {
      console.warn("[transitionPhaseAndEmit] CAS failed — run superseded", {
        dealId,
        runId: opts.runId,
        targetPhase: finalPhase,
      });
    }
  } catch (phaseErr: any) {
    console.error("[processConfirmedIntake] failed to update intake_phase", {
      dealId,
      phase: finalPhase,
      error: phaseErr?.message,
    });
    // Re-throw DB errors so callers can react (retry or escalate).
    // Without this, the deal silently stays in CONFIRMED_READY_FOR_PROCESSING.
    throw phaseErr;
  }

  void writeEvent({
    dealId,
    kind: "intake.confirmed_processing_complete",
    scope: "intake",
    meta: {
      docs_processed: opts.docsProcessed,
      match_results: opts.matchCount,
      extract_results: opts.extractCount,
      error_count: opts.errorCount,
      final_phase: finalPhase,
      duration_ms: durationMs,
      processing_version: PROCESSING_VERSION,
      confirmation_version: INTAKE_CONFIRMATION_VERSION,
      observability_version: PROCESSING_OBSERVABILITY_VERSION,
      run_id: opts.runId ?? null,
      fatal: opts.fatal ?? false,
    },
  });
}
