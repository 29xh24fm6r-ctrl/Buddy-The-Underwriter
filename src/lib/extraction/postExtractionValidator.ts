import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { getFormSpec, validateDocumentFacts, isSpreadGenerationAllowed } from "@/lib/irsKnowledge";
import type { IrsFormType, ValidationStatus } from "@/lib/irsKnowledge/types";

// ── Canonical doc type → IRS form type map ──────────────────────────

const DOC_TYPE_TO_IRS_FORM: Record<string, IrsFormType> = {
  TAX_RETURN_1065: "FORM_1065",
  TAX_RETURN_1120: "FORM_1120",
  TAX_RETURN_1120S: "FORM_1120S",
  TAX_RETURN_1040: "FORM_1040",
  PARTNERSHIP_RETURN: "FORM_1065",
  CORPORATE_RETURN: "FORM_1120",
  S_CORP_RETURN: "FORM_1120S",
  PERSONAL_TAX_RETURN: "FORM_1040",
  INDIVIDUAL_TAX_RETURN: "FORM_1040",
  SCHEDULE_E: "SCHEDULE_E",
};

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
 * CRITICAL: Never throws. Returns SKIPPED on any error.
 * Validation must never break extraction.
 */
export async function runPostExtractionValidation(
  documentId: string,
  dealId: string,
  canonicalType: string,
  taxYear: number | null,
): Promise<PostExtractionValidationResult> {
  try {
    // a) Map canonical doc type → IRS form type
    const irsFormType = DOC_TYPE_TO_IRS_FORM[canonicalType];
    if (!irsFormType) {
      return {
        documentId,
        status: "SKIPPED",
        summary: `No IRS form mapping for type: ${canonicalType}`,
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // b) Get form spec
    const spec = getFormSpec(irsFormType, taxYear ?? 2024);
    if (!spec) {
      return {
        documentId,
        status: "SKIPPED",
        summary: `No form spec for ${irsFormType} ${taxYear}`,
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // c) Query facts for this document
    const sb = supabaseAdmin();
    const { data: factRows, error: factsError } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num")
      .eq("deal_id", dealId)
      .eq("source_document_id", documentId);

    if (factsError || !factRows || factRows.length === 0) {
      return {
        documentId,
        status: "SKIPPED",
        summary: factsError
          ? `Facts query failed: ${factsError.message}`
          : "No facts found for document",
        spreadGenerationAllowed: true,
        requiresAnalystSignOff: false,
      };
    }

    // Build fact map
    const facts: Record<string, number | null> = {};
    for (const row of factRows as { fact_key: string; fact_value_num: number | null }[]) {
      facts[row.fact_key] = row.fact_value_num;
    }

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
