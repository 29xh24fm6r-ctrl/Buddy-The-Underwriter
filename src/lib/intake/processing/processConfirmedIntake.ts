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
import { INTAKE_CONFIRMATION_VERSION } from "@/lib/intake/confirmation/types";

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
): Promise<ProcessConfirmedResult> {
  const sb = supabaseAdmin();
  const errors: string[] = [];
  const matchResults: Array<{ documentId: string; decision: string }> = [];
  const extractResults: Array<{ documentId: string; ok: boolean }> = [];

  // 1. Load all confirmed docs
  const { data: docs, error: loadErr } = await (sb as any)
    .from("deal_documents")
    .select(
      `id, canonical_type, document_type, original_filename,
       ai_doc_type, ai_confidence, ai_tax_year, ai_form_numbers,
       classification_tier,
       gatekeeper_doc_type, gatekeeper_route, gatekeeper_confidence,
       gatekeeper_needs_review, gatekeeper_tax_year`,
    )
    .eq("deal_id", dealId)
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

  // 2. Per-doc: matching + extraction + spread recompute
  for (const doc of confirmedDocs) {
    const effectiveDocType =
      doc.canonical_type ?? doc.document_type ?? doc.ai_doc_type ?? "";

    const gkBlockedByReview =
      doc.gatekeeper_needs_review === true ||
      doc.gatekeeper_route === "NEEDS_REVIEW";

    // 2a. Matching
    if (!gkBlockedByReview && effectiveDocType) {
      try {
        const { runMatchForDocument } = await import(
          "@/lib/intake/matching/runMatch"
        );

        const spineSignals = doc.ai_doc_type
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

        const gkSignals = doc.gatekeeper_doc_type
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
        });

        matchResults.push({
          documentId: doc.id,
          decision: matchResult.decision,
        });
      } catch (err: any) {
        errors.push(`match:${doc.id}:${err?.message}`);
      }
    }

    // 2b. Extraction
    if (
      !gkBlockedByReview &&
      effectiveDocType &&
      EXTRACT_ELIGIBLE.has(effectiveDocType)
    ) {
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

    // 2c. Spread recompute
    try {
      const { spreadsForDocType } = await import(
        "@/lib/financialSpreads/docTypeToSpreadTypes"
      );
      const { enqueueSpreadRecompute } = await import(
        "@/lib/financialSpreads/enqueueSpreadRecompute"
      );
      const spreadTypes = spreadsForDocType(effectiveDocType);
      if (spreadTypes.length > 0) {
        await enqueueSpreadRecompute({
          dealId,
          bankId,
          sourceDocumentId: doc.id,
          spreadTypes,
          meta: {
            source: "confirmed_intake",
            confirmation_version: INTAKE_CONFIRMATION_VERSION,
          },
        });
      }
    } catch (err: any) {
      errors.push(`spread:${doc.id}:${err?.message}`);
    }
  }

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

  // 4. Emit completion event
  void writeEvent({
    dealId,
    kind: "intake.confirmed_processing_complete",
    scope: "intake",
    meta: {
      docs_processed: confirmedDocs.length,
      match_results: matchResults.length,
      extract_results: extractResults.length,
      error_count: errors.length,
      confirmation_version: INTAKE_CONFIRMATION_VERSION,
    },
  });

  return {
    ok: errors.length === 0,
    docsProcessed: confirmedDocs.length,
    matchResults,
    extractResults,
    errors,
  };
}
