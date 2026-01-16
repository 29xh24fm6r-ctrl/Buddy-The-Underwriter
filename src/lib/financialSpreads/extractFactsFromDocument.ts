import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractSourcesUsesFactsFromText } from "@/lib/intel/extractors/sourcesUses";
import { extractCollateralFactsFromText } from "@/lib/intel/extractors/collateral";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

/**
 * Placeholder extractor.
 *
 * Once you upload the PDF templates + sample docs, we'll implement deterministic parsing rules
 * that emit normalized facts into deal_financial_facts.
 */
export async function extractFactsFromDocument(args: {
  dealId: string;
  bankId: string;
  documentId: string;
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
  const docType = classRes.data?.doc_type ? String(classRes.data.doc_type) : null;

  const normDocType = (docType ?? "").trim().toUpperCase();
  const shouldExtractSourcesUses = ["TERM_SHEET", "LOI", "CLOSING_STATEMENT"].includes(normDocType);
  const shouldExtractCollateral = ["APPRAISAL", "COLLATERAL_SCHEDULE"].includes(normDocType);

  let factsWritten = 0;

  // Best-effort: extract just the minimum "ready" metrics from OCR text.
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

  // Record a minimal provenance marker so we can trace that this pipeline ran.
  const fact = {
    deal_id: args.dealId,
    bank_id: args.bankId,
    source_document_id: args.documentId,
    fact_type: "EXTRACTION_HEARTBEAT",
    fact_key: `document:${args.documentId}`,
    fact_period_start: null,
    fact_period_end: null,
    fact_value_num: extractedText ? extractedText.length : null,
    fact_value_text: docType,
    currency: "USD",
    confidence: classRes.data?.confidence ?? null,
    provenance: {
      extractor: "extractFactsFromDocument:v0",
      doc_type: docType,
    },
  };

  const { error } = await (sb as any)
    .from("deal_financial_facts")
    .upsert(fact, {
      onConflict:
        "deal_id,bank_id,source_document_id,fact_type,fact_key,fact_period_start,fact_period_end",
    } as any);

  if (error) {
    throw new Error(`deal_financial_facts_upsert_failed:${error.message}`);
  }

  return { ok: true as const, factsWritten: factsWritten + 1 };
}
