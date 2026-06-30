import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { getFormSpec, validateDocumentFacts, isSpreadGenerationAllowed } from "@/lib/irsKnowledge";
import { canonicalizeFactMap } from "@/lib/irsKnowledge/canonicalFactKeys";
import type { ValidationStatus } from "@/lib/irsKnowledge/types";
import { resolveIrsFormType, isValidatableDocument } from "./resolveIrsFormType";

// ── Return type ─────────────────────────────────────────────────────

export type PostExtractionValidationResult = {
  documentId: string;
  status: ValidationStatus | "SKIPPED";
  summary: string;
  spreadGenerationAllowed: boolean;
  requiresAnalystSignOff: boolean;
};

// ── Main entry point ────────────────────────────────────────────────

/**
 * Run IRS identity validation after a successful extraction.
 *
 * SPEC-EXTRACT-VALIDATOR-WIRE-1 (rev 2) §2a — accepts a docRow shape
 * (canonical_type, ai_form_numbers, document_type) rather than a bare
 * canonical-type string. Three self-gates run before any work:
 *
 *   1. deals.validation_disabled = true  →  SKIPPED, no row.
 *   2. Document is not validatable        →  SKIPPED, no row.
 *      (validatable = tax return OR balance sheet; SPEC-BALANCE-SHEET-INTEGRITY-GATE-1)
 *   3. Validatable doc, unresolved form   →  SKIPPED + persisted audit row.
 *
 * CRITICAL: Never throws. Returns SKIPPED on any error.
 * Validation must never break extraction.
 */
export async function runPostExtractionValidation(
  documentId: string,
  dealId: string,
  docRow: {
    canonical_type: string | null;
    ai_form_numbers: string[] | null;
    document_type: string | null;
  },
  taxYear: number | null,
): Promise<PostExtractionValidationResult> {
  const sb = supabaseAdmin();

  try {
    // Self-gate 1: tenant escape hatch. No row persisted; the deal-level flag IS the audit trail.
    const { data: dealRow } = await (sb as any)
      .from("deals")
      .select("validation_disabled")
      .eq("id", dealId)
      .maybeSingle();

    if (dealRow?.validation_disabled) {
      return {
        documentId,
        status: "SKIPPED",
        summary: "validation_disabled=true on deal",
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // Self-gate 2: only validatable documents (tax return OR balance sheet) get IRS
    // identity validation. No row for anything else (bank statements, PFS, AR aging, …).
    if (!isValidatableDocument(docRow)) {
      return {
        documentId,
        status: "SKIPPED",
        summary: `Not a validatable document (canonical_type=${docRow.canonical_type})`,
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // a) Resolve IRS form type — tax-return doc but unresolvable form gets an audit row.
    const irsFormType = resolveIrsFormType(docRow);
    if (!irsFormType) {
      const summary = `No IRS form type resolvable. canonical_type=${docRow.canonical_type}, ai_form_numbers=${JSON.stringify(docRow.ai_form_numbers)}`;
      await persistSkipped(sb, dealId, documentId, summary);
      return {
        documentId,
        status: "SKIPPED",
        summary,
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // b) Get form spec
    const spec = getFormSpec(irsFormType, taxYear ?? 2024);
    if (!spec) {
      const summary = `No form spec for ${irsFormType} ${taxYear}`;
      await persistSkipped(sb, dealId, documentId, summary, irsFormType, taxYear);
      return {
        documentId,
        status: "SKIPPED",
        summary,
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // c) Query facts for this document
    const { data: factRows, error: factsError } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num")
      .eq("deal_id", dealId)
      .eq("source_document_id", documentId);

    if (factsError || !factRows || factRows.length === 0) {
      const summary = factsError
        ? `Facts query failed: ${factsError.message}`
        : "No facts found for document";
      await persistSkipped(sb, dealId, documentId, summary, irsFormType, taxYear);
      return {
        documentId,
        status: "SKIPPED",
        summary,
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // Build raw fact map (extractor vocabulary)
    const rawFacts: Record<string, number | null> = {};
    for (const row of factRows as { fact_key: string; fact_value_num: number | null }[]) {
      rawFacts[row.fact_key] = row.fact_value_num;
    }

    // SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 1: normalize extractor keys to
    // the canonical FormSpec vocabulary so identity-check operands bind. Without
    // this every check is skipped and the gate verifies nothing.
    const facts = canonicalizeFactMap(rawFacts);

    // d) Run identity validation
    const result = validateDocumentFacts(documentId, spec, facts);

    // e) Upsert to deal_document_validation_results
    await (sb as any)
      .from("deal_document_validation_results")
      .upsert(
        {
          document_id: documentId,
          deal_id: dealId,
          form_type: result.formType,
          tax_year: result.taxYear,
          status: result.status,
          check_results: result.checkResults,
          passed_count: result.passedCount,
          failed_count: result.failedCount,
          skipped_count: result.skippedCount,
          summary: result.summary,
          validated_at: result.validatedAt,
        },
        { onConflict: "document_id" },
      );

    // f) Emit ledger event
    writeEvent({
      dealId,
      kind: "extraction.identity_validation_complete",
      scope: "extraction",
      action: "identity_validation_complete",
      meta: {
        document_id: documentId,
        form_type: result.formType,
        tax_year: result.taxYear,
        status: result.status,
        passed_count: result.passedCount,
        failed_count: result.failedCount,
        skipped_count: result.skippedCount,
        summary: result.summary,
      },
    }).catch(() => {});

    // g) Aegis findings for FLAGGED/BLOCKED
    if (result.status === "FLAGGED" || result.status === "BLOCKED") {
      const failedChecks = result.checkResults
        .filter(r => !r.skipped && !r.passed)
        .map(r => `${r.checkId}: delta $${r.delta?.toFixed(0)} (tolerance $${r.toleranceDollars})`)
        .join("; ");

      await (sb as any)
        .from("buddy_system_events")
        .insert({
          deal_id: dealId,
          event_type: result.status === "BLOCKED" ? "error" : "warning",
          severity: result.status === "BLOCKED" ? "HIGH" : "MEDIUM",
          error_class: "EXTRACTION_ACCURACY",
          error_code: "IRS_IDENTITY_CHECK_FAILED",
          error_signature: `irs_identity_${result.formType}_${result.taxYear}`,
          error_message: `IRS Identity Check ${result.status}: ${result.formType} ${result.taxYear}. ${result.summary}`,
          source_system: "irs_identity_validator",
          source_job_id: documentId,
          source_job_table: "deal_documents",
          resolution_status: "open",
          payload: {
            document_id: documentId,
            form_type: result.formType,
            tax_year: result.taxYear,
            status: result.status,
            failed_checks: failedChecks,
            check_results: result.checkResults,
          },
        })
        .then(() => {})
        .catch(() => {});
    }

    // h) Check spread generation gate
    const gate = isSpreadGenerationAllowed([result]);

    return {
      documentId,
      status: result.status,
      summary: result.summary,
      spreadGenerationAllowed: gate.allowed,
      requiresAnalystSignOff: gate.requiresAnalystSignOff,
    };
  } catch (err) {
    // CRITICAL: Never throw — return SKIPPED
    console.warn("[PostExtractionValidator] Validation failed (non-fatal):", err);
    return {
      documentId,
      status: "SKIPPED",
      summary: `Validation error: ${err instanceof Error ? err.message : "unknown"}`,
      spreadGenerationAllowed: true,
      requiresAnalystSignOff: false,
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

async function persistSkipped(
  sb: any,
  dealId: string,
  documentId: string,
  summary: string,
  formType: string | null = null,
  taxYear: number | null = null,
): Promise<void> {
  await sb
    .from("deal_document_validation_results")
    .upsert(
      {
        document_id: documentId,
        deal_id: dealId,
        form_type: formType,
        tax_year: taxYear,
        status: "SKIPPED",
        check_results: [],
        passed_count: 0,
        failed_count: 0,
        skipped_count: 0,
        summary,
        validated_at: new Date().toISOString(),
      },
      { onConflict: "document_id" },
    )
    .then(() => {})
    .catch(() => {});
}
