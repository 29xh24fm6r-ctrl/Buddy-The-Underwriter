import "server-only";
import type { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { isGoogleDocAiEnabled } from "@/lib/flags/googleDocAi";
import { getVercelWifAuthClient } from "@/lib/gcp/vercelAuth";
import { hasWifProviderConfig } from "@/lib/google/wif/getWifProvider";

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

function isVercelRuntime(): boolean {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
}

export type DocAiAuthMode = "vercel_wif" | "json" | "adc";

/**
 * Returns which auth mode will be used without constructing a client.
 * Useful for tests and diagnostics.
 */
export function docAiAuthMode(): DocAiAuthMode {
  if (isVercelRuntime() && hasWifProviderConfig()) return "vercel_wif";
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim()) return "json";
  return "adc";
}

let cachedClient: DocumentProcessorServiceClient | null = null;
let cachedAuthMode: DocAiAuthMode | null = null;

async function buildDocAiClient(): Promise<DocumentProcessorServiceClient> {
  if (cachedClient) return cachedClient;

  // Dynamic import — keeps @google-cloud/documentai out of the webpack bundle.
  // The module is only resolved at runtime on the server when DocAI is enabled.
  const { DocumentProcessorServiceClient: Client } = await import("@google-cloud/documentai");

  const mode = docAiAuthMode();
  console.log("[DocAI] Building client", { authMode: mode });

  // 1. Vercel WIF (preferred on Vercel — matches GCS & Vertex auth)
  if (mode === "vercel_wif") {
    try {
      const authClient = await getVercelWifAuthClient();
      cachedClient = new Client({ authClient: authClient as any });
      cachedAuthMode = mode;
      return cachedClient;
    } catch (e: any) {
      console.error("[DocAI] WIF auth failed, cannot fall back", {
        error: e?.message,
        runtime: isVercelRuntime() ? "vercel" : "local",
      });
      throw new Error(`DocAI WIF auth failed: ${e?.message ?? "unknown"}`);
    }
  }

  // 2. Inline credentials JSON (legacy / local testing)
  if (mode === "json") {
    const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON!;
    try {
      const credentials = JSON.parse(credsJson);
      cachedClient = new Client({ credentials });
      cachedAuthMode = mode;
      return cachedClient;
    } catch (e) {
      throw new Error(`Failed to parse GOOGLE_APPLICATION_CREDENTIALS_JSON: ${(e as Error).message}`);
    }
  }

  // 3. ADC (local dev with gcloud auth or GOOGLE_APPLICATION_CREDENTIALS file)
  cachedClient = new Client();
  cachedAuthMode = mode;
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
 * Auth modes (selected by buildDocAiClient):
 *   - vercel_wif: Vercel OIDC → WIF → SA impersonation (production)
 *   - json: GOOGLE_APPLICATION_CREDENTIALS_JSON inline (legacy / test)
 *   - adc: Application Default Credentials (local dev with gcloud)
 *
 * Requires environment variables:
 * - GOOGLE_DOCAI_ENABLED=true
 * - GOOGLE_CLOUD_PROJECT (or GOOGLE_PROJECT_ID)
 * - GOOGLE_DOCAI_LOCATION (defaults to "us")
 * - GOOGLE_DOCAI_TAX_PROCESSOR_ID (for tax returns)
 * - GOOGLE_DOCAI_FINANCIAL_PROCESSOR_ID (for income stmt, balance sheet, PFS)
 * - (Vercel) GCP_WIF_PROVIDER + GCP_SERVICE_ACCOUNT_EMAIL
 * - (Local) GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_JSON
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
  let client: DocumentProcessorServiceClient;
  try {
    client = await buildDocAiClient();
  } catch (authErr: any) {
    logLedgerEvent({
      dealId,
      bankId,
      eventKey: "docai.auth.failed",
      uiState: "error",
      uiMessage: `DocAI auth failed: ${String(authErr?.message ?? "unknown").slice(0, 120)}`,
      meta: {
        docId,
        processorType,
        authMode: docAiAuthMode(),
        runtime: isVercelRuntime() ? "vercel" : "local",
        hasWif: hasWifProviderConfig(),
        hasCredsJson: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim()),
        hasAdc: Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS),
      },
    }).catch(() => {});
    throw authErr;
  }
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
