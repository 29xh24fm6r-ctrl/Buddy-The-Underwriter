import "server-only";
import { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { isGoogleDocAiEnabled } from "@/lib/flags/googleDocAi";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DocAiProcessorType = "TAX_PROCESSOR" | "FINANCIAL_PROCESSOR";

export type ExtractWithGoogleDocAiArgs = {
  docId: string;
  dealId: string;
  bankId: string;
  processorType: DocAiProcessorType;
  storageBucket?: string;
  storagePath?: string;
};

export type ProviderMetrics = {
  provider: "google_doc_ai";
  processorType: DocAiProcessorType;
  processorId?: string;
  location?: string;
  pages?: number;
  model?: string;
  latencyMs?: number;
  textLength?: number;
  estimated_cost_usd?: number;
  unit_count?: number;
};

export type DocAiResult = {
  ok: true;
  text: string;
  json: unknown;
  provider_metrics: ProviderMetrics;
};

// ─── Cost Estimation ──────────────────────────────────────────────────────────

function estimateDocAiCostUSD(pages: number, processorType: DocAiProcessorType): number {
  // Conservative estimates - replace with actual negotiated pricing
  // Tax processor is more expensive due to specialized parsing
  const perPage = processorType === "TAX_PROCESSOR" ? 0.06 : 0.04;
  return Math.round(pages * perPage * 100) / 100;
}

// ─── GCP Config ───────────────────────────────────────────────────────────────

function getDocAiProjectId(): string {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCS_PROJECT_ID ||
    process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "Missing Google Cloud project id. Set GOOGLE_CLOUD_PROJECT (recommended) or GOOGLE_PROJECT_ID.",
    );
  }
  return projectId;
}

function getDocAiLocation(): string {
  return process.env.GOOGLE_DOCAI_LOCATION || process.env.GOOGLE_CLOUD_LOCATION || "us";
}

// ─── Client Builder ──────────────────────────────────────────────────────────

let cachedClient: DocumentProcessorServiceClient | null = null;

function buildDocAiClient(): DocumentProcessorServiceClient {
  if (cachedClient) return cachedClient;

  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  // If creds JSON exists, use it explicitly (best for Vercel)
  if (credsJson && credsJson.trim()) {
    try {
      const credentials = JSON.parse(credsJson);
      cachedClient = new DocumentProcessorServiceClient({ credentials });
      return cachedClient;
    } catch (e) {
      throw new Error(`Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON: ${(e as Error).message}`);
    }
  }

  // Otherwise fall back to ADC (works on GCP runtimes with workload identity)
  cachedClient = new DocumentProcessorServiceClient();
  return cachedClient;
}

function getProcessorId(processorType: DocAiProcessorType): string {
  // These should be configured per environment with actual processor IDs
  if (processorType === "TAX_PROCESSOR") {
    const id = process.env.GOOGLE_DOCAI_TAX_PROCESSOR_ID;
    if (!id) throw new Error("GOOGLE_DOCAI_TAX_PROCESSOR_ID not configured");
    return id;
  }

  const id = process.env.GOOGLE_DOCAI_FINANCIAL_PROCESSOR_ID;
  if (!id) throw new Error("GOOGLE_DOCAI_FINANCIAL_PROCESSOR_ID not configured");
  return id;
}

// ─── Document Loading ─────────────────────────────────────────────────────────

async function loadDocumentBytes(args: {
  docId: string;
  dealId: string;
  storageBucket?: string;
  storagePath?: string;
}): Promise<{ bytes: Buffer; mimeType: string; pageCount?: number }> {
  const sb = supabaseAdmin();

  // Load document metadata
  const { data: doc, error } = await (sb as any)
    .from("deal_documents")
    .select("id, deal_id, bank_id, storage_bucket, storage_path, mime_type, page_count, original_filename")
    .eq("id", args.docId)
    .single();

  if (error || !doc) {
    throw new Error(`doc_not_found: ${args.docId}`);
  }

  const bucket = args.storageBucket || doc.storage_bucket || "deal-documents";
  const path = args.storagePath || doc.storage_path;

  if (!path) {
    throw new Error(`doc_missing_storage_path: ${args.docId}`);
  }

  // Download from Supabase storage
  const dl = await sb.storage.from(bucket).download(path);
  if (dl.error) {
    throw new Error(`storage_download_failed: ${dl.error.message}`);
  }

  const bytes = Buffer.from(await dl.data.arrayBuffer());
  const mimeType = doc.mime_type || "application/pdf";
  const pageCount = doc.page_count ?? undefined;

  return { bytes, mimeType, pageCount };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Extract document content using Google Document AI.
 *
 * This module:
 * 1. Loads document bytes from Supabase storage
 * 2. Calls Google Document AI processDocument API
 * 3. Returns extracted text, full JSON response, and provider metrics
 *
 * Requires environment variables:
 * - GOOGLE_DOCAI_ENABLED=true
 * - GOOGLE_CLOUD_PROJECT (or GOOGLE_PROJECT_ID)
 * - GOOGLE_DOCAI_LOCATION (defaults to "us")
 * - GOOGLE_DOCAI_TAX_PROCESSOR_ID (for tax returns)
 * - GOOGLE_DOCAI_FINANCIAL_PROCESSOR_ID (for income stmt, balance sheet, PFS)
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON (service account JSON, for Vercel)
 */
export async function extractWithGoogleDocAi(
  args: ExtractWithGoogleDocAiArgs,
): Promise<DocAiResult> {
  // Belt-and-suspenders: block execution even if router somehow bypasses the gate
  if (!isGoogleDocAiEnabled()) {
    throw new Error(
      "Google Document AI is disabled (GOOGLE_DOCAI_ENABLED != true). " +
      "This call should have been caught by the router — investigate.",
    );
  }

  const { docId, dealId, bankId, processorType, storageBucket, storagePath } = args;
  const started = Date.now();

  console.log("[DocAI] Starting extraction", {
    docId,
    dealId,
    processorType,
  });

  // Load document bytes
  const { bytes, mimeType, pageCount } = await loadDocumentBytes({
    docId,
    dealId,
    storageBucket,
    storagePath,
  });

  // ─── Get processor config ────────────────────────────────────────────────────
  const projectId = getDocAiProjectId();
  const location = getDocAiLocation();
  const processorId = getProcessorId(processorType);

  console.log("[DocAI] Calling Document AI", {
    docId,
    projectId,
    location,
    processorId,
    processorType,
    fileSize: bytes.length,
    mimeType,
  });

  // ─── Make the actual Document AI API call ───────────────────────────────────
  const client = buildDocAiClient();
  const processorName = `projects/${projectId}/locations/${location}/processors/${processorId}`;

  const [result] = await client.processDocument({
    name: processorName,
    rawDocument: {
      content: bytes.toString("base64"),
      mimeType,
    },
  });

  const elapsedMs = Date.now() - started;
  const doc = result.document;
  const extractedText = doc?.text ?? "";
  const docAiPageCount = Array.isArray(doc?.pages) ? doc!.pages!.length : undefined;
  const finalPageCount = docAiPageCount ?? pageCount;

  const provider_metrics: ProviderMetrics = {
    provider: "google_doc_ai",
    processorType,
    processorId,
    location,
    pages: finalPageCount,
    latencyMs: elapsedMs,
    textLength: extractedText.length,
    model: `doc_ai_${processorType.toLowerCase()}`,
    estimated_cost_usd: finalPageCount ? estimateDocAiCostUSD(finalPageCount, processorType) : undefined,
    unit_count: finalPageCount ?? undefined,
  };

  // Log completion to ledger
  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "extract.docai.completed",
    uiState: "done",
    uiMessage: `Document AI extraction completed`,
    meta: {
      docId,
      processorType,
      elapsed_ms: elapsedMs,
      pages: finalPageCount,
      text_length: extractedText.length,
      provider_metrics,
    },
  });

  console.log("[DocAI] Extraction completed", {
    docId,
    processorType,
    elapsed_ms: elapsedMs,
    pages: finalPageCount,
    text_length: extractedText.length,
  });

  return {
    ok: true,
    text: extractedText,
    json: result, // Full DocAI response for audit + downstream parsing
    provider_metrics,
  };
}
