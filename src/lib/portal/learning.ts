import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "@/lib/supabase/admin";

/**
 * Build normalized request label: "title | category"
 */
export function buildRequestLabel(title: string, category?: string | null): string {
  const t = title.trim().toLowerCase();
  const c = category?.trim().toLowerCase();
  return c ? `${t} | ${c}` : t;
}

/**
 * Extract year from filename: "2023_tax_return.pdf" → 2023
 */
function extractYear(filename: string): number | null {
  const m = filename.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Tokenize text: "2023 Tax Return" → ["2023", "tax", "return"]
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/**
 * Extract keywords from filename + OCR text
 */
function buildKeywords(filename: string, ocrText: string | null): string[] {
  const fn = tokenize(filename);
  const ocr = ocrText ? tokenize(ocrText.slice(0, 1000)) : [];
  return Array.from(new Set([...fn, ...ocr]));
}

type Upload = {
  id: string;
  file_key: string;
  classified_doc_type?: string | null;
  extracted_year?: number | null;
  ocr_text?: string | null;
  original_filename?: string | null;
};

/**
 * Upsert deal-specific hint (100% weight)
 * Keyed by: (deal_id, request_id, doc_type, year)
 */
export async function upsertDealHint(
  sb: SupabaseClient<Database>,
  params: {
    dealId: string;
    bankId: string;
    requestId: string;
    upload: Upload;
  }
): Promise<void> {
  const { dealId, bankId, requestId, upload } = params;

  const docType = upload.classified_doc_type || null;
  const year = upload.extracted_year || extractYear(upload.original_filename || "");
  const filename = upload.original_filename || upload.file_key.split("/").pop() || "";
  const kw = buildKeywords(filename, upload.ocr_text || null);

  // Match record if doc_type + year match
  const matchKey =
    docType && year ? { doc_type: docType, year } : docType ? { doc_type: docType } : null;

  if (!matchKey) return; // No doc_type = no learning

  // Upsert deal hint
  await sb
    .from("borrower_match_hints")
    .upsert(
      {
        deal_id: dealId,
        bank_id: bankId,
        request_id: requestId,
        ...matchKey,
        filename_tokens: kw,
        keywords: kw,
        hit_count: 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,request_id,doc_type,year", ignoreDuplicates: false }
    )
    .throwOnError();
}

/**
 * Upsert bank-wide prior (60% weight)
 * Keyed by: (bank_id, template_id, doc_type, year) OR (bank_id, label, doc_type, year)
 */
export async function upsertBankPrior(
  sb: SupabaseClient<Database>,
  params: {
    bankId: string;
    templateId?: string | null;
    requestTitle: string;
    requestCategory?: string | null;
    upload: Upload;
  }
): Promise<void> {
  const { bankId, templateId, requestTitle, requestCategory, upload } = params;

  const docType = upload.classified_doc_type || null;
  const year = upload.extracted_year || extractYear(upload.original_filename || "");
  const filename = upload.original_filename || upload.file_key.split("/").pop() || "";
  const kw = buildKeywords(filename, upload.ocr_text || null);
  const label = buildRequestLabel(requestTitle, requestCategory);
  const labelTokens = tokenize(label);

  // Match key
  const matchKey =
    docType && year ? { doc_type: docType, year } : docType ? { doc_type: docType } : null;

  if (!matchKey) return; // No doc_type = no learning

  // Check if template_id prior exists
  if (templateId) {
    const { data: existing } = await sb
      .from("borrower_bank_match_priors")
      .select("id,hit_count,keywords,label_tokens")
      .eq("bank_id", bankId)
      .eq("template_id", templateId)
      .eq("doc_type", docType)
      .eq("year", year || 0)
      .maybeSingle();

    if (existing) {
      // Accumulate keywords + label_tokens
      const newKeywords = Array.from(new Set([...(existing.keywords || []), ...kw]));
      const newLabelTokens = Array.from(new Set([...(existing.label_tokens || []), ...labelTokens]));

      await sb
        .from("borrower_bank_match_priors")
        .update({
          hit_count: existing.hit_count + 1,
          keywords: newKeywords,
          label_tokens: newLabelTokens,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .throwOnError();
    } else {
      // Insert new template_id prior
      await sb
        .from("borrower_bank_match_priors")
        .insert({
          bank_id: bankId,
          template_id: templateId,
          label,
          label_tokens: labelTokens,
          ...matchKey,
          keywords: kw,
          hit_count: 1,
          updated_at: new Date().toISOString(),
        })
        .throwOnError();
    }
  } else {
    // No template_id → fallback to label-based prior
    const { data: existing } = await sb
      .from("borrower_bank_match_priors")
      .select("id,hit_count,keywords,label_tokens")
      .eq("bank_id", bankId)
      .eq("label", label)
      .eq("doc_type", docType)
      .eq("year", year || 0)
      .is("template_id", null)
      .maybeSingle();

    if (existing) {
      // Accumulate keywords + label_tokens
      const newKeywords = Array.from(new Set([...(existing.keywords || []), ...kw]));
      const newLabelTokens = Array.from(new Set([...(existing.label_tokens || []), ...labelTokens]));

      await sb
        .from("borrower_bank_match_priors")
        .update({
          hit_count: existing.hit_count + 1,
          keywords: newKeywords,
          label_tokens: newLabelTokens,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .throwOnError();
    } else {
      // Insert new label-based prior
      await sb
        .from("borrower_bank_match_priors")
        .insert({
          bank_id: bankId,
          label,
          label_tokens: labelTokens,
          ...matchKey,
          keywords: kw,
          hit_count: 1,
          updated_at: new Date().toISOString(),
        })
        .throwOnError();
    }
  }
}
