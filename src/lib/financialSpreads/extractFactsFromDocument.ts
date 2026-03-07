import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractSourcesUsesFactsFromText } from "@/lib/intel/extractors/sourcesUses";
import { extractCollateralFactsFromText } from "@/lib/intel/extractors/collateral";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";
import { writeSystemEvent } from "@/lib/aegis/writeSystemEvent";

// ── Legacy Claude-based extractors (deprecated — kept for rollback) ──────────
import { extractIncomeStatement } from "@/lib/financialSpreads/extractors/incomeStatementExtractor";
import { extractBalanceSheet } from "@/lib/financialSpreads/extractors/balanceSheetExtractor";
import { extractTaxReturn } from "@/lib/financialSpreads/extractors/taxReturnExtractor";
import { extractRentRoll } from "@/lib/financialSpreads/extractors/rentRollExtractor";
import { extractPersonalIncome } from "@/lib/financialSpreads/extractors/personalIncomeExtractor";
import { extractPfs } from "@/lib/financialSpreads/extractors/pfsExtractor";

// ── Deterministic extractors (no LLM calls) ─────────────────────────────────
import { extractIncomeStatementDeterministic } from "@/lib/financialSpreads/extractors/deterministic/incomeStatementDeterministic";
import { extractBalanceSheetDeterministic } from "@/lib/financialSpreads/extractors/deterministic/balanceSheetDeterministic";
import { extractTaxReturnDeterministic } from "@/lib/financialSpreads/extractors/deterministic/taxReturnDeterministic";
import { extractRentRollDeterministic } from "@/lib/financialSpreads/extractors/deterministic/rentRollDeterministic";
import { extractPersonalIncomeDeterministic } from "@/lib/financialSpreads/extractors/deterministic/personalIncomeDeterministic";
import { extractPfsDeterministic } from "@/lib/financialSpreads/extractors/deterministic/pfsDeterministic";
import { resolveDocTaxYear } from "@/lib/financialSpreads/extractors/deterministic/parseUtils";
import { isGeminiPrimaryExtractionEnabled } from "@/lib/flags/geminiPrimaryExtraction";

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

function isDeterministicEnabled(): boolean {
  // Legacy Claude-based extractors have been removed — deterministic is now
  // the only working path.  Default to true unless explicitly disabled.
  return process.env.DETERMINISTIC_EXTRACTORS_ENABLED !== "false";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveOwnerForDocument(sb: any, documentId: string): Promise<string | null> {
  const { data } = await sb
    .from("deal_documents")
    .select("assigned_owner_id")
    .eq("id", documentId)
    .maybeSingle();
  return data?.assigned_owner_id ? String(data.assigned_owner_id) : null;
}

/**
 * Load structured JSON from extraction assist from document_extracts.
 * Returns the structured JSON blob or null if not available.
 */
async function loadStructuredJson(sb: any, documentId: string): Promise<unknown | null> {
  try {
    const { data } = await (sb as any)
      .from("document_extracts")
      .select("fields_json")
      .eq("attachment_id", documentId)
      .eq("status", "SUCCEEDED")
      .maybeSingle();
    return data?.fields_json?.structuredJson ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main extractor
// ---------------------------------------------------------------------------

/**
 * Unified fact extractor.
 *
 * When DETERMINISTIC_EXTRACTORS_ENABLED=true, routes to deterministic parsers
 * that use Document AI structured JSON + OCR regex (zero LLM calls).
 *
 * When false (default), uses legacy Claude-based extractors.
 *
 * Falls back to rule-based extractors for Sources & Uses and Collateral.
 */
export async function extractFactsFromDocument(args: {
  dealId: string;
  bankId: string;
  documentId: string;
  /** Fallback doc type when document_classifications is empty (e.g. from document_artifacts) */
  docTypeHint?: string;
}) {
  const sb = supabaseAdmin();
  const useDeterministic = isDeterministicEnabled();
  const useGeminiPrimary = isGeminiPrimaryExtractionEnabled();

  // TODO: remove after pipeline validation
  if (process.env.DEBUG_PIPELINE === "true" || process.env.NODE_ENV !== "production") {
    console.log("[extractFactsFromDocument] env", {
      dealId: args.dealId,
      documentId: args.documentId,
      docTypeHint: args.docTypeHint,
      DETERMINISTIC_EXTRACTORS_ENABLED: process.env.DETERMINISTIC_EXTRACTORS_ENABLED,
      useDeterministic,
      useGeminiPrimary,
    });
  }

  // Fetch OCR + classification context + DocAI JSON (best-effort, parallel)
  const [ocrRes, classRes, structuredJson] = await Promise.all([
    (sb as any)
      .from("document_ocr_results")
      .select("extracted_text")
      .eq("attachment_id", args.documentId)
      .maybeSingle(),
    (sb as any)
      .from("document_classifications")
      .select("doc_type, confidence")
      .eq("attachment_id", args.documentId)
      .maybeSingle(),
    useDeterministic ? loadStructuredJson(sb, args.documentId) : Promise.resolve(null),
  ]);

  let extractedText = String(ocrRes.data?.extracted_text ?? "");

  // Fallback: document_extracts.fields_json.extractedText written by processConfirmedIntake/extractByDocType.
  // Bridges the two pipelines — OCR processor writes to document_ocr_results,
  // but processConfirmedIntake (Gemini OCR job) writes to document_extracts.
  if (!extractedText) {
    try {
      const { data: extractsRow } = await (sb as any)
        .from("document_extracts")
        .select("fields_json")
        .eq("attachment_id", args.documentId)
        .eq("status", "SUCCEEDED")
        .maybeSingle();
      const fallbackText = extractsRow?.fields_json?.extractedText;
      if (typeof fallbackText === "string" && fallbackText.length > 0) {
        extractedText = fallbackText;
        console.log("[extractFactsFromDocument] OCR fallback: loaded text from document_extracts", {
          documentId: args.documentId,
          length: extractedText.length,
        });
      }
    } catch {
      // Non-fatal — proceed without fallback
    }
  }

  // Always fetch deal_documents for doc_year (period resolution) + doc_type fallback + storage info
  const { data: dealDoc } = await sb
    .from("deal_documents")
    .select("document_type, ai_doc_type, canonical_type, doc_year, storage_bucket, storage_path, mime_type")
    .eq("id", args.documentId)
    .maybeSingle();

  // Priority chain for doc type resolution:
  // 1. deal_documents.canonical_type (banker-corrected — highest authority)
  // 2. document_classifications (written by classifyProcessor job pipeline)
  // 3. deal_documents.ai_doc_type / document_type (processArtifact or manual UI)
  // 4. args.docTypeHint (caller-supplied fallback, e.g. from document_artifacts.doc_type)
  let docType = dealDoc?.canonical_type
    ? String(dealDoc.canonical_type)
    : null;

  if (!docType) {
    docType = classRes.data?.doc_type
      ? String(classRes.data.doc_type)
      : null;
  }

  if (!docType) {
    docType = dealDoc?.ai_doc_type
      ? String(dealDoc.ai_doc_type)
      : dealDoc?.document_type
        ? String(dealDoc.document_type)
        : null;
  }

  if (!docType) {
    docType = args.docTypeHint ?? null;
  }

  const normDocType = (docType ?? "").trim().toUpperCase();
  const docYear: number | null = dealDoc?.doc_year ? Number(dealDoc.doc_year) : null;

  let factsWritten = 0;
  let extractionPath: string | null = null;
  let extractorRan = false;

  // ── Extractor args ──────────────────────────────────────────────────────
  const baseArgs = {
    dealId: args.dealId,
    bankId: args.bankId,
    documentId: args.documentId,
    ocrText: extractedText,
  };

  const deterministicArgs = {
    ...baseArgs,
    structuredJson: structuredJson ?? undefined,
    docYear,
  };

  // ── Native PDF download (best-effort for Gemini native input) ─────────
  let pdfBase64: string | undefined;
  let pdfMimeType: string | undefined;
  if (useGeminiPrimary && dealDoc?.storage_bucket && dealDoc?.storage_path) {
    try {
      const { downloadPrivateObject } = await import("@/lib/storage/adminStorage");
      const bytes = await downloadPrivateObject({
        bucket: dealDoc.storage_bucket,
        path: dealDoc.storage_path,
      });
      pdfBase64 = Buffer.from(bytes).toString("base64");
      pdfMimeType = dealDoc.mime_type ?? "application/pdf";
    } catch (dlErr: any) {
      console.warn("[extractFactsFromDocument] PDF download failed, using OCR text fallback", {
        documentId: args.documentId,
        error: dlErr?.message,
      });
    }
  }

  // ── Gemini primary helper ───────────────────────────────────────────────
  // Shared logic: attempt Gemini primary extraction, write facts if successful.
  // Returns { succeeded, factsWritten } — never throws.
  async function attemptGeminiPrimary(factType: string): Promise<{
    succeeded: boolean;
    factsWritten: number;
  }> {
    if (!useGeminiPrimary || !useDeterministic) {
      return { succeeded: false, factsWritten: 0 };
    }
    try {
      const { extractWithGeminiPrimary } = await import(
        "@/lib/financialSpreads/extractors/gemini/geminiDocumentExtractor"
      );
      const gemResult = await extractWithGeminiPrimary({
        dealId: args.dealId,
        bankId: args.bankId,
        documentId: args.documentId,
        ocrText: extractedText,
        docType: normDocType,
        docYear,
        pdfBase64,
        mimeType: pdfMimeType,
      });
      if (gemResult.ok && gemResult.items.length > 0) {
        const { writeFactsBatch } = await import(
          "@/lib/financialSpreads/extractors/shared"
        );
        const wr = await writeFactsBatch({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: args.documentId,
          factType,
          items: gemResult.items,
        });
        return { succeeded: true, factsWritten: wr.factsWritten };
      }
      return { succeeded: false, factsWritten: 0 };
    } catch (err: any) {
      console.warn("[extractFactsFromDocument] Gemini primary failed, falling back", {
        dealId: args.dealId,
        documentId: args.documentId,
        docType: normDocType,
        error: err?.message,
      });
      return { succeeded: false, factsWritten: 0 };
    }
  }

  // ── Income Statement / T12 ─────────────────────────────────────────────
  if (
    extractedText &&
    ["FINANCIAL_STATEMENT", "INCOME_STATEMENT", "OPERATING_STATEMENT"].includes(normDocType)
  ) {
    extractorRan = true;
    const gp = await attemptGeminiPrimary("INCOME_STATEMENT");
    if (gp.succeeded) {
      factsWritten += gp.factsWritten;
      extractionPath = "gemini_primary";
    } else {
      try {
        if (useDeterministic) {
          const result = await extractIncomeStatementDeterministic(deterministicArgs);
          factsWritten += result.factsWritten;
          extractionPath = result.extractionPath;
        } else {
          const result = await extractIncomeStatement(baseArgs);
          factsWritten += result.factsWritten;
        }
      } catch (err) {
        console.error("[extractFactsFromDocument] incomeStatement failed:", err);
      }
    }
  }

  // ── Balance Sheet ──────────────────────────────────────────────────────
  if (extractedText && normDocType === "BALANCE_SHEET") {
    extractorRan = true;
    const gp = await attemptGeminiPrimary("BALANCE_SHEET");
    if (gp.succeeded) {
      factsWritten += gp.factsWritten;
      extractionPath = "gemini_primary";
    } else {
      try {
        if (useDeterministic) {
          const result = await extractBalanceSheetDeterministic(deterministicArgs);
          factsWritten += result.factsWritten;
          extractionPath = result.extractionPath;
        } else {
          const result = await extractBalanceSheet(baseArgs);
          factsWritten += result.factsWritten;
        }
      } catch (err) {
        console.error("[extractFactsFromDocument] balanceSheet failed:", err);
      }
    }
  }

  // ── Tax Return ─────────────────────────────────────────────────────────
  if (
    extractedText &&
    ["IRS_1040", "IRS_1120", "IRS_1120S", "IRS_1065", "IRS_BUSINESS", "IRS_PERSONAL", "K1", "BUSINESS_TAX_RETURN", "TAX_RETURN", "PERSONAL_TAX_RETURN"].includes(normDocType)
  ) {
    extractorRan = true;
    const gp = await attemptGeminiPrimary("TAX_RETURN");
    if (gp.succeeded) {
      factsWritten += gp.factsWritten;
      extractionPath = "gemini_primary";
    } else {
      try {
        if (useDeterministic) {
          const result = await extractTaxReturnDeterministic(deterministicArgs);
          factsWritten += result.factsWritten;
          extractionPath = result.extractionPath;
        } else {
          const result = await extractTaxReturn(baseArgs);
          factsWritten += result.factsWritten;
        }
      } catch (err) {
        console.error("[extractFactsFromDocument] taxReturn failed:", err);
      }
    }

    // Persist resolved tax year to document_artifacts (backfill NULL gap)
    try {
      const resolvedYear = resolveDocTaxYear(extractedText, docYear);
      if (resolvedYear) {
        await (sb as any)
          .from("document_artifacts")
          .update({ tax_year: resolvedYear, updated_at: new Date().toISOString() })
          .eq("source_table", "deal_documents")
          .eq("source_id", args.documentId)
          .is("tax_year", null);
      }
    } catch {
      // Non-fatal — tax year backfill is best-effort
    }
  }

  // ── Rent Roll ──────────────────────────────────────────────────────────
  if (extractedText && normDocType === "RENT_ROLL") {
    extractorRan = true;
    const gp = await attemptGeminiPrimary("RENT_ROLL");
    if (gp.succeeded) {
      factsWritten += gp.factsWritten;
      extractionPath = "gemini_primary";
    } else {
      try {
        if (useDeterministic) {
          const result = await extractRentRollDeterministic(deterministicArgs);
          factsWritten += result.factsWritten;
          extractionPath = result.extractionPath;
        } else {
          const result = await extractRentRoll(baseArgs);
          factsWritten += result.factsWritten;
        }
      } catch (err) {
        console.error("[extractFactsFromDocument] rentRoll failed:", err);
      }
    }
  }

  // ── Personal Income (1040 / personal tax returns) ──────────────────────
  if (
    extractedText &&
    ["PERSONAL_TAX_RETURN", "IRS_1040", "IRS_PERSONAL"].includes(normDocType)
  ) {
    extractorRan = true;
    // Note: Personal income Gemini primary uses PERSONAL_INCOME fact type
    // but attemptGeminiPrimary does not pass ownerEntityId — personal docs
    // handled by deterministic for now (owner resolution needed)
    const gp = await attemptGeminiPrimary("PERSONAL_INCOME");
    if (gp.succeeded) {
      factsWritten += gp.factsWritten;
      extractionPath = "gemini_primary";
    } else {
      try {
        const ownerEntityId = await resolveOwnerForDocument(sb, args.documentId);
        if (useDeterministic) {
          const result = await extractPersonalIncomeDeterministic({
            ...deterministicArgs,
            ownerEntityId,
          });
          factsWritten += result.factsWritten;
          extractionPath = result.extractionPath;
        } else {
          const result = await extractPersonalIncome({
            ...baseArgs,
            ownerEntityId,
          });
          factsWritten += result.factsWritten;
        }
      } catch (err) {
        console.error("[extractFactsFromDocument] personalIncome failed:", err);
      }
    }

    // Persist resolved tax year to document_artifacts (backfill NULL gap)
    try {
      const resolvedYear = resolveDocTaxYear(extractedText, docYear);
      if (resolvedYear) {
        await (sb as any)
          .from("document_artifacts")
          .update({ tax_year: resolvedYear, updated_at: new Date().toISOString() })
          .eq("source_table", "deal_documents")
          .eq("source_id", args.documentId)
          .is("tax_year", null);
      }
    } catch {
      // Non-fatal — tax year backfill is best-effort
    }
  }

  // ── PFS ────────────────────────────────────────────────────────────────
  if (
    extractedText &&
    ["PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413"].includes(normDocType)
  ) {
    extractorRan = true;
    // Try Gemini primary first
    const gp = await attemptGeminiPrimary("PFS");
    if (gp.succeeded) {
      factsWritten += gp.factsWritten;
      extractionPath = "gemini_primary";
    } else {
      try {
        const ownerEntityId = await resolveOwnerForDocument(sb, args.documentId);
        if (useDeterministic) {
          const result = await extractPfsDeterministic({
            ...deterministicArgs,
            ownerEntityId,
          });
          factsWritten += result.factsWritten;
          extractionPath = result.extractionPath;
        } else {
          const result = await extractPfs({
            ...baseArgs,
            ownerEntityId,
          });
          factsWritten += result.factsWritten;
        }
      } catch (err) {
        console.error("[extractFactsFromDocument] pfs failed:", err);
      }
    }
  }

  // ── Bank Statement ─────────────────────────────────────────────────
  if (extractedText && normDocType === "BANK_STATEMENT") {
    extractorRan = true;
    const gp = await attemptGeminiPrimary("BANK_STATEMENT");
    if (gp.succeeded) {
      factsWritten += gp.factsWritten;
      extractionPath = "gemini_primary";
    }
    // No deterministic fallback for bank statements — Gemini primary only
  }

  // ── Debt Schedule ──────────────────────────────────────────────────
  if (
    extractedText &&
    ["DEBT_SCHEDULE", "SCHEDULE_OF_OBLIGATIONS", "EXISTING_DEBT"].includes(normDocType)
  ) {
    extractorRan = true;
    const gp = await attemptGeminiPrimary("DEBT_SCHEDULE");
    if (gp.succeeded) {
      factsWritten += gp.factsWritten;
      extractionPath = "gemini_primary";
    }
    // No deterministic fallback for debt schedules — Gemini primary only
  }

  // ── Rule-based extractors (existing) ───────────────────────────────────
  const shouldExtractSourcesUses = ["TERM_SHEET", "LOI", "CLOSING_STATEMENT"].includes(normDocType);
  const shouldExtractCollateral = ["APPRAISAL", "COLLATERAL_SCHEDULE"].includes(normDocType);

  if (extractedText && (shouldExtractSourcesUses || shouldExtractCollateral)) {
    extractorRan = true;
    const sourcesUsesFacts = shouldExtractSourcesUses
      ? extractSourcesUsesFactsFromText({ extractedText, documentId: args.documentId, docType })
      : [];

    const collateralFacts = shouldExtractCollateral
      ? extractCollateralFactsFromText({ extractedText, documentId: args.documentId, docType })
      : [];

    const writes = [
      ...sourcesUsesFacts.map((f) =>
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: args.documentId,
          factType: "SOURCES_USES",
          factKey: f.factKey,
          factValueNum: f.value,
          confidence: f.confidence,
          provenance: f.provenance,
        }),
      ),
      ...collateralFacts.map((f) =>
        upsertDealFinancialFact({
          dealId: args.dealId,
          bankId: args.bankId,
          sourceDocumentId: args.documentId,
          factType: "COLLATERAL",
          factKey: f.factKey,
          factValueNum: f.value,
          confidence: f.confidence,
          provenance: f.provenance,
        }),
      ),
    ];

    const results = await Promise.all(writes);
    for (const r of results) {
      if (r.ok) factsWritten += 1;
    }
  }

  // ── Aegis: EXTRACTION_ZERO_FACTS finding ───────────────────────────────
  if (extractorRan && factsWritten === 0 && extractedText.length > 100) {
    writeSystemEvent({
      event_type: "warning",
      severity: "warning",
      source_system: "extract_processor",
      deal_id: args.dealId,
      bank_id: args.bankId,
      error_code: "EXTRACTION_ZERO_FACTS",
      error_message: `Zero facts extracted from ${normDocType} document (${extractedText.length} chars OCR)`,
      payload: {
        finding: "EXTRACTION_ZERO_FACTS",
        doc_type: normDocType,
        document_id: args.documentId,
        ocr_length: extractedText.length,
        had_structured_json: !!structuredJson,
        deterministic: useDeterministic,
        gemini_primary: useGeminiPrimary,
        extraction_path: extractionPath,
      },
    }).catch(() => {}); // fire-and-forget
  }

  // ── Extraction heartbeat ───────────────────────────────────────────────
  const hbResult = await upsertDealFinancialFact({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    factType: "EXTRACTION_HEARTBEAT",
    factKey: `document:${args.documentId}`,
    factValueNum: extractedText ? extractedText.length : null,
    factValueText: docType,
    confidence: classRes.data?.confidence ?? null,
    provenance: {
      source_type: "DOC_EXTRACT",
      source_ref: `deal_documents:${args.documentId}`,
      as_of_date: null,
      extractor: useGeminiPrimary
        ? "extractFactsFromDocument:v5:gemini_primary"
        : useDeterministic
          ? "extractFactsFromDocument:v4:deterministic"
          : "extractFactsFromDocument:v3",
      ...(extractionPath ? { extraction_path: extractionPath } : {}),
    },
  });

  if (!hbResult.ok) {
    throw new Error(`deal_financial_facts_upsert_failed:${hbResult.error}`);
  }

  // ── Period correction: backfill sentinel dates with docYear ────────
  // Extractors resolve periods from OCR text with docYear as fallback.
  // If any facts still landed on the sentinel date (1900-01-01), correct
  // them now using docYear so multi-year columns render correctly.
  if (docYear && factsWritten > 0) {
    try {
      const periodStart = `${docYear}-01-01`;
      const periodEnd = `${docYear}-12-31`;
      await (sb as any)
        .from("deal_financial_facts")
        .update({ fact_period_start: periodStart, fact_period_end: periodEnd })
        .eq("deal_id", args.dealId)
        .eq("source_document_id", args.documentId)
        .neq("fact_type", "EXTRACTION_HEARTBEAT")
        .eq("fact_period_end", "1900-01-01");
    } catch {
      // Non-fatal — period correction is best-effort
    }
  }

  // ── D1: Validation Gate — GATING (institutional) ─────────────────
  // Run structural validation. If SUSPECT → delete extracted facts, route to review.
  try {
    const { runValidationGate } = await import(
      "@/lib/spreads/preflight/validateExtractedFinancials"
    );

    // Read back the facts we just wrote for this document
    const { data: docFacts } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, fact_value_text, fact_type")
      .eq("deal_id", args.dealId)
      .eq("source_document_id", args.documentId)
      .neq("fact_type", "EXTRACTION_HEARTBEAT");

    if (docFacts && docFacts.length > 0) {
      const gate = runValidationGate({
        docType: normDocType,
        facts: docFacts,
        expectedYear: docYear,
      });

      // Stamp quality status
      await (sb as any)
        .from("deal_documents")
        .update({ extraction_quality_status: gate.result.status })
        .eq("id", args.documentId);

      // D1: If SUSPECT → delete extracted facts (except heartbeat) + emit event
      if (gate.result.status === "SUSPECT") {
        console.warn("[extractFactsFromDocument] Validation gate SUSPECT — deleting extracted facts", {
          documentId: args.documentId,
          dealId: args.dealId,
          reasonCode: gate.result.reason_code,
          message: gate.result.message,
          checks: gate.checks.map((c) => ({
            check: c.check,
            status: c.result.status,
            reason: c.result.reason_code,
          })),
        });

        // Delete non-heartbeat facts for this document
        await (sb as any)
          .from("deal_financial_facts")
          .delete()
          .eq("deal_id", args.dealId)
          .eq("source_document_id", args.documentId)
          .neq("fact_type", "EXTRACTION_HEARTBEAT");

        factsWritten = 0;

        // Emit canonical ledger event for traceability
        const { writeEvent } = await import("@/lib/ledger/writeEvent");
        void writeEvent({
          dealId: args.dealId,
          kind: "extraction.validation.failed",
          scope: "extraction",
          action: "validation_gated",
          requiresHumanReview: true,
          meta: {
            document_id: args.documentId,
            doc_type: normDocType,
            reason_code: gate.result.reason_code,
            message: gate.result.message,
            checks: gate.checks,
            facts_deleted: docFacts.length,
          },
        }).catch(() => {});
      } else {
        // Phase 5: Stamp reconciliation_status on balance sheet facts
        const bsCheck = gate.checks.find((c) => c.check === "type_validation");
        const dtUpper = normDocType?.toUpperCase() ?? "";
        if (
          (dtUpper === "BALANCE_SHEET" || dtUpper === "PERSONAL_FINANCIAL_STATEMENT" || dtUpper === "PFS" || dtUpper === "SBA_413") &&
          bsCheck
        ) {
          const reconStatus = bsCheck.result.status === "PASSED" ? "BALANCED" : "IMBALANCED";
          await (sb as any)
            .from("deal_financial_facts")
            .update({ reconciliation_status: reconStatus })
            .eq("deal_id", args.dealId)
            .eq("source_document_id", args.documentId)
            .neq("fact_type", "EXTRACTION_HEARTBEAT");
        }

        // Emit validation passed event
        const { writeEvent } = await import("@/lib/ledger/writeEvent");
        void writeEvent({
          dealId: args.dealId,
          kind: "extraction.validation.passed",
          scope: "extraction",
          action: "validation_passed",
          meta: {
            document_id: args.documentId,
            doc_type: normDocType,
            checks: gate.checks,
            facts_count: docFacts.length,
          },
        }).catch(() => {});
      }
    }
  } catch (err) {
    // Validation gate failure → conservative: keep facts, log warning
    console.warn("[extractFactsFromDocument] validation gate failed:", err);
  }

  return { ok: true as const, factsWritten: factsWritten + 1 };
}
