import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

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

  return { ok: true as const, factsWritten: 1 };
}
