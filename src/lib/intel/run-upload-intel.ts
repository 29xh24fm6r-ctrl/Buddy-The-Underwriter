import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractBankFeesProducts } from "./extractors/bankStatements";
import { extractFinancialStatements } from "./extractors/financialStatements";

// Placeholder types - replace with your actual upload type
type BorrowerUpload = {
  id: string;
  deal_id?: string;
  dealId?: string;
  storage_bucket?: string;
  storage_path?: string;
  [key: string]: any;
};

// Placeholder: Implement your actual upload fetcher
async function getBorrowerUpload(uploadId: string): Promise<BorrowerUpload> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("borrower_uploads")
    .select("*")
    .eq("id", uploadId)
    .single();

  if (error || !data) throw new Error(`Upload not found: ${uploadId}`);
  return data as BorrowerUpload;
}

// Placeholder: Implement your actual file downloader
async function downloadUploadBytes(upload: BorrowerUpload): Promise<{ bytes: Buffer }> {
  const sb = supabaseAdmin();
  const bucket = upload.storage_bucket || "borrower-uploads";
  const path = upload.storage_path;

  if (!path) throw new Error("Upload missing storage_path");

  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error) throw new Error(`Download failed: ${error.message}`);

  const bytes = Buffer.from(await data.arrayBuffer());
  return { bytes };
}

// Placeholder: Implement your actual OCR loader
async function tryLoadOcrJsonForUpload(upload: BorrowerUpload): Promise<any | null> {
  // TODO: Load from your document_ocr_results table or similar
  // Example:
  // const sb = supabaseServer();
  // const { data } = await sb
  //   .from("document_ocr_results")
  //   .select("raw")
  //   .eq("file_id", upload.id)
  //   .maybeSingle();
  // return data?.raw || null;
  return null;
}

// Placeholder: Convert Azure DI JSON to tokens
function azureToTokens(ocrJson: any): string {
  // TODO: Extract text from Azure Document Intelligence format
  // Example: ocrJson?.analyzeResult?.content || ""
  return ocrJson?.analyzeResult?.content || JSON.stringify(ocrJson).slice(0, 50000);
}

// Placeholder: Extract text from PDF bytes
function nativePdfToTokens(bytes: Buffer): string {
  // TODO: Use pdf-parse or similar to extract text
  // For now, return empty string (OCR path is preferred)
  return "";
}

// Placeholder: Classify document from tokens
function classifyFromTokens(tokens: string): any {
  const lower = tokens.toLowerCase();
  
  if (lower.includes("statement") && lower.includes("account")) {
    return { doc_type: "BANK_STATEMENT", confidence: 0.7 };
  }
  if (lower.includes("balance sheet") || lower.includes("income statement")) {
    return { doc_type: "FINANCIAL_STATEMENT", confidence: 0.7 };
  }
  
  return { doc_type: "UNKNOWN", confidence: 0.0 };
}

export async function runUploadIntel(uploadId: string) {
  const sb = supabaseAdmin();

  const upload = await getBorrowerUpload(uploadId);
  const dealId = upload.deal_id || upload.dealId;
  if (!dealId) throw new Error("borrower_uploads row missing deal_id");

  const { bytes } = await downloadUploadBytes(upload);

  const ocrJson = await tryLoadOcrJsonForUpload(upload);
  const tokens = ocrJson ? azureToTokens(ocrJson) : nativePdfToTokens(bytes);

  const classifier = classifyFromTokens(tokens);

  // Run BOTH (Option 1 + 2)
  const bank = extractBankFeesProducts(tokens);
  const fin = extractFinancialStatements(tokens);

  const results = [bank, fin].filter(r => (r.confidence ?? 0) >= 0.4);

  for (const r of results) {
    const payload = {
      upload_id: uploadId,
      deal_id: dealId,
      kind: r.kind,
      fields: { ...r.fields, classifier, ocrUsed: Boolean(ocrJson) },
      tables: r.tables ?? [],
      evidence: r.evidence ?? [],
    };

    const { error } = await sb.from("borrower_upload_extractions").insert(payload);
    if (error) throw new Error(error.message);
  }

  return { ok: true, uploadId, dealId, stored: results.map(r => r.kind), classifier };
}
