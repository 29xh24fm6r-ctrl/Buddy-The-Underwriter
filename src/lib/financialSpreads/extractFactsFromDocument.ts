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

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

function isDeterministicEnabled(): boolean {
  return process.env.DETERMINISTIC_EXTRACTORS_ENABLED === "true";
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
 * Load Document AI structured JSON from document_extracts.
 * Returns the structuredJson blob or null if not available.
 */
async function loadDocAiJson(sb: any, documentId: string): Promise<unknown | null> {
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

  // TODO: remove after pipeline validation
  if (process.env.DEBUG_PIPELINE === "true" || process.env.NODE_ENV !== "production") {
    console.log("[extractFactsFromDocument] env", {
      dealId: args.dealId,
      documentId: args.documentId,
      docTypeHint: args.docTypeHint,
      DETERMINISTIC_EXTRACTORS_ENABLED: process.env.DETERMINISTIC_EXTRACTORS_ENABLED,
      useDeterministic,
    });
  }

  // Fetch OCR + classification context + DocAI JSON (best-effort, parallel)
  const [ocrRes, classRes, docAiJson] = await Promise.all([
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
    useDeterministic ? loadDocAiJson(sb, args.documentId) : Promise.resolve(null),
  ]);

  const extractedText = String(ocrRes.data?.extracted_text ?? "");

  // Use document_classifications first, fall back to caller-supplied hint
  // (document_artifacts.doc_type) when the legacy classification table is empty
  const docType = classRes.data?.doc_type
    ? String(classRes.data.doc_type)
    : (args.docTypeHint ?? null);

  const normDocType = (docType ?? "").trim().toUpperCase();

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
    docAiJson: docAiJson ?? undefined,
  };

  // ── Income Statement / T12 ─────────────────────────────────────────────
  if (
    extractedText &&
    ["FINANCIAL_STATEMENT", "T12", "INCOME_STATEMENT", "TRAILING_12", "OPERATING_STATEMENT"].includes(normDocType)
  ) {
    extractorRan = true;
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

  // ── Balance Sheet ──────────────────────────────────────────────────────
  if (extractedText && normDocType === "BALANCE_SHEET") {
    extractorRan = true;
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

  // ── Tax Return ─────────────────────────────────────────────────────────
  if (
    extractedText &&
    ["IRS_1040", "IRS_1120", "IRS_1120S", "IRS_1065", "IRS_BUSINESS", "IRS_PERSONAL", "K1", "BUSINESS_TAX_RETURN", "TAX_RETURN"].includes(normDocType)
  ) {
    extractorRan = true;
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

  // ── Rent Roll ──────────────────────────────────────────────────────────
  if (extractedText && normDocType === "RENT_ROLL") {
    extractorRan = true;
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

  // ── Personal Income (1040 / personal tax returns) ──────────────────────
  if (
    extractedText &&
    ["PERSONAL_TAX_RETURN", "IRS_1040", "IRS_PERSONAL"].includes(normDocType)
  ) {
    extractorRan = true;
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

  // ── PFS ────────────────────────────────────────────────────────────────
  if (
    extractedText &&
    ["PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413"].includes(normDocType)
  ) {
    extractorRan = true;
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
        had_docai_json: !!docAiJson,
        deterministic: useDeterministic,
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
      extractor: useDeterministic
        ? "extractFactsFromDocument:v4:deterministic"
        : "extractFactsFromDocument:v3",
      ...(extractionPath ? { extraction_path: extractionPath } : {}),
    },
  });

  if (!hbResult.ok) {
    throw new Error(`deal_financial_facts_upsert_failed:${hbResult.error}`);
  }

  return { ok: true as const, factsWritten: factsWritten + 1 };
}
