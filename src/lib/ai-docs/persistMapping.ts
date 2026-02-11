import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { mapGeminiScanToChecklist, GeminiScanResult } from "./mapToChecklist";
import { isExtractionErrorPayload } from "@/lib/artifacts/extractionError";

export async function persistAiMapping(args: {
  dealId: string;
  documentId: string;
  scan: GeminiScanResult;
  model?: string;
}) {
  const { dealId, documentId, scan } = args;
  const sb = supabaseAdmin();

  const suggestions = mapGeminiScanToChecklist(scan);

  // 1) Update document with AI fields (for UX + audit). Best-effort for schema drift.
  try {
    await sb
      .from("deal_documents")
      .update({
        ai_doc_type: scan.docType || null,
        ai_issuer: scan.issuer || null,
        ai_form_numbers: scan.formNumbers || null,
        ai_tax_year: scan.taxYear ?? null,
        ai_period_start: scan.periodStart || null,
        ai_period_end: scan.periodEnd || null,
        ai_borrower_name: scan.borrowerName || null,
        ai_business_name: scan.businessName || null,
        ai_confidence: scan.confidence ?? null,
        ai_model: args.model || "gemini",
        ai_reason: suggestions[0]?.reason ?? null,
        ai_extracted_json: isExtractionErrorPayload(scan.extracted) ? null : (scan.extracted ?? null),
      } as any)
      .eq("id", documentId);
  } catch {
    // ignore
  }

  // 2) Insert mapping evidence rows.
  if (suggestions.length) {
    const rows = suggestions.map((s) => ({
      deal_id: dealId,
      document_id: documentId,
      checklist_key: s.checklistKey,
      doc_year: s.docYear ?? null,
      confidence: s.confidence,
      status: s.confidence >= 0.9 ? "auto_accepted" : s.confidence >= 0.7 ? "suggested" : "suggested",
      reason: s.reason,
      features: s.features,
    }));

    try {
      await sb.from("deal_doc_mappings").insert(rows as any);
    } catch {
      // ignore
    }

    // 3) If we have a very high confidence mapping, stamp deal_documents.checklist_key/doc_year
    // so existing deterministic checklist reconciliation can satisfy items without trusting filenames.
    const top = suggestions[0];
    if (top && top.confidence >= 0.9) {
      try {
        await sb
          .from("deal_documents")
          .update({
            checklist_key: top.checklistKey,
            doc_year: top.docYear ?? null,
            match_source: "ai_mapping",
            match_confidence: top.confidence,
            match_reason: top.reason,
          } as any)
          .eq("id", documentId)
          .is("checklist_key", null);
      } catch {
        // ignore
      }
    }
  }

  return { suggestions };
}
