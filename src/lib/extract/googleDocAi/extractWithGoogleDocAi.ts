import "server-only";
import type { DocumentProcessorServiceClient } from "@google-cloud/documentai";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { isGoogleDocAiEnabled } from "@/lib/flags/googleDocAi";
import { getVercelWifAuthClient } from "@/lib/gcp/vercelAuth";
import { hasWifProviderConfig } from "@/lib/google/wif/getWifProvider";
import { applyPageOffsetToDocAiJson } from "./applyPageOffsetToDocAiJson";

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
  chunks?: number;
};

export type DocAiResult = {
  ok: true;
  text: string;
  json: unknown;
  provider_metrics: ProviderMetrics;
};

// ─── Preflight Limits ─────────────────────────────────────────────────────────

/** Hard limit: Document AI sync ProcessDocument accepts at most 15 pages */
export const DOCAI_SYNC_MAX_PAGES = 15;

/** Hard limit: Document AI sync ProcessDocument accepts at most 20 MB */
export const DOCAI_SYNC_MAX_BYTES = 20 * 1024 * 1024;

/** Max chunks before falling back to Gemini — avoids excessive API calls and latency */
export const DOCAI_MAX_CHUNKS = 10;

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
    const envKey = "GOOGLE_DOCAI_TAX_PROCESSOR_ID";
    const id = process.env[envKey];
    if (!id) throw new Error(`missing_processor_id:${processorType}:env=${envKey}`);
    return id;
  }

  const envKey = "GOOGLE_DOCAI_FINANCIAL_PROCESSOR_ID";
  const id = process.env[envKey];
  if (!id) throw new Error(`missing_processor_id:${processorType}:env=${envKey}`);
  return id;
}

// ─── PDF Chunking ─────────────────────────────────────────────────────────────

/**
 * Split a PDF into sequential chunks of at most maxPages pages each.
 * Uses pdf-lib (dynamic import) — proven pattern from segmentation engine.
 */
async function splitPdfIntoChunks(
  bytes: Buffer,
  maxPages: number,
): Promise<Array<{ chunkIndex: number; startPage: number; endPage: number; bytes: Buffer }>> {
  const { PDFDocument } = await import("pdf-lib");
  const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  const chunks: Array<{ chunkIndex: number; startPage: number; endPage: number; bytes: Buffer }> = [];

  for (let start = 0; start < totalPages; start += maxPages) {
    const end = Math.min(start + maxPages, totalPages);
    const pageIndices = Array.from({ length: end - start }, (_, i) => start + i);

    const chunkDoc = await PDFDocument.create();
    const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices);
    for (const page of copiedPages) {
      chunkDoc.addPage(page);
    }

    const chunkBytes = Buffer.from(await chunkDoc.save());
    chunks.push({
      chunkIndex: chunks.length,
      startPage: start + 1, // 1-indexed for display
      endPage: end,
      bytes: chunkBytes,
    });
  }

  return chunks;
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
    .select("id, deal_id, bank_id, storage_bucket, storage_path, mime_type, original_filename")
    .eq("id", args.docId)
    .single();

  if (error || !doc) {
    console.error("[DocAI:loadDocumentBytes] PostgREST error loading deal_document", {
      docId: args.docId,
      code: error?.code,
      message: error?.message,
      hint: error?.hint,
    });
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
  const pageCount = undefined;

  return { bytes, mimeType, pageCount };
}

// ─── Chunked Processing ──────────────────────────────────────────────────────

/**
 * Process a large PDF in chunks — split into ≤DOCAI_SYNC_MAX_PAGES-page pieces,
 * run DocAI per chunk sequentially, merge text + JSON outputs.
 *
 * Throws docai_limits_exceeded if any chunk exceeds byte limit.
 */
async function processDocAiChunked(args: {
  bytes: Buffer;
  mimeType: string;
  pageCount: number;
  docId: string;
  dealId: string;
  bankId: string;
  processorType: DocAiProcessorType;
  started: number;
}): Promise<DocAiResult> {
  const { bytes, mimeType, pageCount, docId, dealId, bankId, processorType, started } = args;

  // ── Pre-split guard: reject if too many chunks required ──────────────────
  const chunksRequired = Math.ceil(pageCount / DOCAI_SYNC_MAX_PAGES);
  if (chunksRequired > DOCAI_MAX_CHUNKS) {
    logLedgerEvent({
      dealId,
      bankId,
      eventKey: "extract.docai_skipped_limits",
      uiState: "working",
      uiMessage: `Document requires ${chunksRequired} chunks (max ${DOCAI_MAX_CHUNKS}) — too many for DocAI`,
      meta: { docId, processorType, pageCount, chunks_required: chunksRequired, max_chunks: DOCAI_MAX_CHUNKS },
    }).catch(() => {});

    throw new Error(
      `docai_limits_exceeded:chunks_required=${chunksRequired}:max_chunks=${DOCAI_MAX_CHUNKS}:pages=${pageCount}`,
    );
  }

  const chunks = await splitPdfIntoChunks(bytes, DOCAI_SYNC_MAX_PAGES);

  console.log("[DocAI] Chunked extraction — split complete", {
    docId,
    pageCount,
    chunks: chunks.length,
    maxPagesPerChunk: DOCAI_SYNC_MAX_PAGES,
  });

  // Validate chunk sizes — if any single chunk exceeds byte limit, fall back entirely
  for (const chunk of chunks) {
    if (chunk.bytes.length > DOCAI_SYNC_MAX_BYTES) {
      logLedgerEvent({
        dealId,
        bankId,
        eventKey: "extract.docai_chunk_skipped_limits",
        uiState: "working",
        uiMessage: `DocAI chunk ${chunk.chunkIndex + 1} exceeds byte limit (${Math.round(chunk.bytes.length / 1024 / 1024)}MB)`,
        meta: {
          docId,
          processorType,
          chunkIndex: chunk.chunkIndex,
          chunkBytes: chunk.bytes.length,
          maxBytes: DOCAI_SYNC_MAX_BYTES,
          chunkPages: `${chunk.startPage}-${chunk.endPage}`,
        },
      }).catch(() => {});

      throw new Error(
        `docai_limits_exceeded:chunk=${chunk.chunkIndex}:bytes=${chunk.bytes.length}:max_bytes=${DOCAI_SYNC_MAX_BYTES}`,
      );
    }
  }

  // Build client + processor config (shared across chunks)
  const projectId = getDocAiProjectId();
  const location = getDocAiLocation();
  const processorId = getProcessorId(processorType);
  const client = await buildDocAiClient();
  const processorName = `projects/${projectId}/locations/${location}/processors/${processorId}`;

  // Process each chunk sequentially, tracking cumulative text offset for evidence normalization
  const chunkResults: Array<{ text: string; json: any; pages: number; latencyMs: number }> = [];
  let cumulativeTextOffset = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkStarted = Date.now();
    let result: any;

    try {
      [result] = await client.processDocument({
        name: processorName,
        rawDocument: {
          content: chunk.bytes.toString("base64"),
          mimeType,
        },
      });
    } catch (processErr: any) {
      processErr.message = `docai_process_failed:${processorType}:${location}:${processorId}:chunk=${chunk.chunkIndex}:${processErr.message}`;
      throw processErr;
    }

    const chunkDoc = result.document;
    const chunkText = chunkDoc?.text ?? "";
    const chunkPages = Array.isArray(chunkDoc?.pages)
      ? chunkDoc.pages.length
      : chunk.endPage - chunk.startPage + 1;

    // ── Producer-normalize: apply page + text offsets directly into DocAI JSON ──
    // After normalization, the JSON looks as if DocAI processed the full document
    // in a single call. No consumer offset logic required.
    const pageOffset = chunks[i].startPage - 1; // 0 for chunk 0, pageCount(chunk0) for chunk 1, etc.
    const normalizedJson = applyPageOffsetToDocAiJson(result, pageOffset, cumulativeTextOffset);

    chunkResults.push({
      text: chunkText,
      json: normalizedJson,
      pages: chunkPages,
      latencyMs: Date.now() - chunkStarted,
    });

    // Advance cumulative text offset: chunk text length + 1 for the "\n" separator
    // (matches the mergedText join("\n") below)
    cumulativeTextOffset += chunkText.length + (i < chunks.length - 1 ? 1 : 0);

    console.log("[DocAI] Chunk processed", {
      docId,
      chunk: `${chunk.chunkIndex + 1}/${chunks.length}`,
      pages: `${chunk.startPage}-${chunk.endPage}`,
      textLength: chunkText.length,
      pageOffset,
      textOffset: cumulativeTextOffset,
      latencyMs: Date.now() - chunkStarted,
    });
  }

  // ── Merge normalized results into a single document-like response ───────────
  // After normalization, each chunk's pages/entities are already in global coordinates.
  // Concatenate into a single response that looks like one DocAI call.
  const mergedText = chunkResults.map((r) => r.text).join("\n");
  const totalLatencyMs = Date.now() - started;

  // Build merged document: concatenate pages[] and entities[] from all chunks
  const mergedPages: any[] = [];
  const mergedEntities: any[] = [];
  for (const cr of chunkResults) {
    const doc = cr.json?.document;
    if (Array.isArray(doc?.pages)) mergedPages.push(...doc.pages);
    if (Array.isArray(doc?.entities)) mergedEntities.push(...doc.entities);
  }

  const mergedJson = {
    // Single merged document — identical structure to a non-chunked DocAI response
    document: {
      text: mergedText,
      pages: mergedPages,
      entities: mergedEntities,
    },
    // Debug metadata — correctness does NOT depend on these fields
    _chunked: true,
    _chunkCount: chunks.length,
    _chunkMeta: chunks.map((c, i) => ({
      _chunkIndex: i,
      _pageOffset: chunks[i].startPage - 1,
      _startPage: chunks[i].startPage,
      _endPage: chunks[i].endPage,
    })),
  };

  const provider_metrics: ProviderMetrics = {
    provider: "google_doc_ai",
    processorType,
    processorId,
    location,
    pages: pageCount,
    latencyMs: totalLatencyMs,
    textLength: mergedText.length,
    model: `doc_ai_${processorType.toLowerCase()}`,
    estimated_cost_usd: estimateDocAiCostUSD(pageCount, processorType),
    unit_count: pageCount,
    chunks: chunks.length,
  };

  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "extract.docai.completed",
    uiState: "done",
    uiMessage: `Document AI chunked extraction completed (${chunks.length} chunks, ${pageCount} pages)`,
    meta: {
      docId,
      processorType,
      elapsed_ms: totalLatencyMs,
      pages: pageCount,
      chunks: chunks.length,
      text_length: mergedText.length,
      provider_metrics,
    },
  });

  console.log("[DocAI] Chunked extraction completed", {
    docId,
    processorType,
    elapsed_ms: totalLatencyMs,
    pages: pageCount,
    chunks: chunks.length,
    text_length: mergedText.length,
  });

  return {
    ok: true,
    text: mergedText,
    // Producer-normalized: merged JSON looks identical to a single DocAI call.
    // All page numbers, page refs, text anchors, and page spans are in global coordinates.
    json: mergedJson,
    provider_metrics,
  };
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

  // ─── Preflight limits gate ──────────────────────────────────────────────────
  // Compute page count via pdf-lib — Do NOT call ProcessDocument when guaranteed to fail.
  // This one change drops DocAI error rate dramatically by not sending doomed requests.
  let pdfPageCount: number | undefined = pageCount;
  if (pdfPageCount === undefined && mimeType.includes("pdf")) {
    try {
      const { PDFDocument } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      pdfPageCount = pdfDoc.getPageCount();
    } catch {
      // pdf-lib parse failure — non-fatal, proceed without page count
    }
  }

  // Chunked path: pages exceed sync limit → split and process per chunk
  if (pdfPageCount && pdfPageCount > DOCAI_SYNC_MAX_PAGES) {
    console.log("[DocAI] Document exceeds page limit — using chunked extraction", {
      docId,
      pages: pdfPageCount,
      maxPages: DOCAI_SYNC_MAX_PAGES,
    });

    return processDocAiChunked({
      bytes,
      mimeType,
      pageCount: pdfPageCount,
      docId,
      dealId,
      bankId,
      processorType,
      started,
    });
  }

  // Byte limit: document is under page limit but over byte limit — cannot chunk further
  if (bytes.length > DOCAI_SYNC_MAX_BYTES) {
    logLedgerEvent({
      dealId,
      bankId,
      eventKey: "extract.docai_skipped_limits",
      uiState: "working",
      uiMessage: `Document exceeds DocAI byte limit (${Math.round(bytes.length / 1024 / 1024)}MB > ${DOCAI_SYNC_MAX_BYTES / 1024 / 1024}MB)`,
      meta: { docId, processorType, bytes: bytes.length, maxBytes: DOCAI_SYNC_MAX_BYTES, pages: pdfPageCount },
    }).catch(() => {});

    throw new Error(
      `docai_limits_exceeded:bytes=${bytes.length}:max_bytes=${DOCAI_SYNC_MAX_BYTES}:pages=${pdfPageCount ?? "unknown"}`,
    );
  }

  // ─── Get processor config (single-call path — under both limits) ────────────
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

  let result: any;
  try {
    [result] = await client.processDocument({
      name: processorName,
      rawDocument: {
        content: bytes.toString("base64"),
        mimeType,
      },
    });
  } catch (processErr: any) {
    processErr.message = `docai_process_failed:${processorType}:${location}:${processorId}:${processErr.message}`;
    throw processErr;
  }

  const elapsedMs = Date.now() - started;
  const doc = result.document;
  const extractedText = doc?.text ?? "";
  const docAiPageCount = Array.isArray(doc?.pages) ? doc!.pages!.length : undefined;
  const finalPageCount = docAiPageCount ?? pdfPageCount ?? pageCount;

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
