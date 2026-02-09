import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractSourcesUsesFactsFromText } from "@/lib/intel/extractors/sourcesUses";
import { extractCollateralFactsFromText } from "@/lib/intel/extractors/collateral";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";
import { extractIncomeStatement } from "@/lib/financialSpreads/extractors/incomeStatementExtractor";
import { extractBalanceSheet } from "@/lib/financialSpreads/extractors/balanceSheetExtractor";
import { extractTaxReturn } from "@/lib/financialSpreads/extractors/taxReturnExtractor";
import { extractRentRoll } from "@/lib/financialSpreads/extractors/rentRollExtractor";
import { extractPersonalIncome } from "@/lib/financialSpreads/extractors/personalIncomeExtractor";
import { extractPfs } from "@/lib/financialSpreads/extractors/pfsExtractor";

/**
 * Unified fact extractor.
 *
 * Routes to the appropriate AI-powered extractor based on document classification.
 * Falls back to rule-based extractors for Sources & Uses and Collateral.
 */
async function resolveOwnerForDocument(sb: any, documentId: string): Promise<string | null> {
  const { data } = await sb
    .from("deal_documents")
    .select("assigned_owner_id")
    .eq("id", documentId)
    .maybeSingle();
  return data?.assigned_owner_id ? String(data.assigned_owner_id) : null;
}

export async function extractFactsFromDocument(args: {
  dealId: string;
  bankId: string;
  documentId: string;
  /** Fallback doc type when document_classifications is empty (e.g. from document_artifacts) */
  docTypeHint?: string;
}) {
  const sb = supabaseAdmin();

  // Fetch OCR + classification context (best-effort)
  const [ocrRes, classRes] = await Promise.all([
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
  ]);

  const extractedText = String(ocrRes.data?.extracted_text ?? "");

  // Use document_classifications first, fall back to caller-supplied hint
  // (document_artifacts.doc_type) when the legacy classification table is empty
  const docType = classRes.data?.doc_type
    ? String(classRes.data.doc_type)
    : (args.docTypeHint ?? null);

  const normDocType = (docType ?? "").trim().toUpperCase();

  let factsWritten = 0;

  // ── AI-powered extractors ────────────────────────────────────────────────
  const aiExtractorArgs = {
    dealId: args.dealId,
    bankId: args.bankId,
    documentId: args.documentId,
    ocrText: extractedText,
  };

  if (
    extractedText &&
    ["FINANCIAL_STATEMENT", "T12", "INCOME_STATEMENT", "TRAILING_12", "OPERATING_STATEMENT"].includes(normDocType)
  ) {
    try {
      const result = await extractIncomeStatement(aiExtractorArgs);
      factsWritten += result.factsWritten;
    } catch (err) {
      console.error("[extractFactsFromDocument] incomeStatementExtractor failed:", err);
    }
  }

  if (extractedText && normDocType === "BALANCE_SHEET") {
    try {
      const result = await extractBalanceSheet(aiExtractorArgs);
      factsWritten += result.factsWritten;
    } catch (err) {
      console.error("[extractFactsFromDocument] balanceSheetExtractor failed:", err);
    }
  }

  if (
    extractedText &&
    ["IRS_1040", "IRS_1120", "IRS_1120S", "IRS_1065", "IRS_BUSINESS", "IRS_PERSONAL", "K1", "BUSINESS_TAX_RETURN", "TAX_RETURN"].includes(normDocType)
  ) {
    try {
      const result = await extractTaxReturn(aiExtractorArgs);
      factsWritten += result.factsWritten;
    } catch (err) {
      console.error("[extractFactsFromDocument] taxReturnExtractor failed:", err);
    }
  }

  if (extractedText && normDocType === "RENT_ROLL") {
    try {
      const result = await extractRentRoll(aiExtractorArgs);
      factsWritten += result.factsWritten;
    } catch (err) {
      console.error("[extractFactsFromDocument] rentRollExtractor failed:", err);
    }
  }

  // ── Personal income extractor (1040 / personal tax returns) ────────────
  if (
    extractedText &&
    ["PERSONAL_TAX_RETURN", "IRS_1040", "IRS_PERSONAL"].includes(normDocType)
  ) {
    try {
      const ownerEntityId = await resolveOwnerForDocument(sb, args.documentId);
      const result = await extractPersonalIncome({
        ...aiExtractorArgs,
        ownerEntityId,
      });
      factsWritten += result.factsWritten;
    } catch (err) {
      console.error("[extractFactsFromDocument] personalIncomeExtractor failed:", err);
    }
  }

  // ── PFS extractor ─────────────────────────────────────────────────────
  if (
    extractedText &&
    ["PFS", "PERSONAL_FINANCIAL_STATEMENT", "SBA_413"].includes(normDocType)
  ) {
    try {
      const ownerEntityId = await resolveOwnerForDocument(sb, args.documentId);
      const result = await extractPfs({
        ...aiExtractorArgs,
        ownerEntityId,
      });
      factsWritten += result.factsWritten;
    } catch (err) {
      console.error("[extractFactsFromDocument] pfsExtractor failed:", err);
    }
  }

  // ── Rule-based extractors (existing) ─────────────────────────────────────
  const shouldExtractSourcesUses = ["TERM_SHEET", "LOI", "CLOSING_STATEMENT"].includes(normDocType);
  const shouldExtractCollateral = ["APPRAISAL", "COLLATERAL_SCHEDULE"].includes(normDocType);

  if (extractedText && (shouldExtractSourcesUses || shouldExtractCollateral)) {
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

  // ── Extraction heartbeat ─────────────────────────────────────────────────
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
      extractor: "extractFactsFromDocument:v3",
    },
  });

  if (!hbResult.ok) {
    throw new Error(`deal_financial_facts_upsert_failed:${hbResult.error}`);
  }

  return { ok: true as const, factsWritten: factsWritten + 1 };
}
