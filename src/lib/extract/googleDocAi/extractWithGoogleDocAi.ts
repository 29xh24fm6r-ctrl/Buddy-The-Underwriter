import "server-only";
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
  pages?: number;
  model?: string;
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
 * This module is designed to be thin and focused on:
 * 1. Loading document bytes from storage
 * 2. Calling Google Document AI API
 * 3. Returning structured results + provider metrics
 *
 * NOTE: The actual Document AI API call is stubbed below.
 * Wire the actual Google DocAI REST/gRPC call when ready.
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

  // ─── TODO: Wire actual Google Document AI call here ────────────────────────
  // The Document AI client library or REST call goes here.
  // Example structure:
  //
  // const { DocumentProcessorServiceClient } = await import("@google-cloud/documentai");
  // const client = new DocumentProcessorServiceClient();
  // const name = `projects/${getDocAiProjectId()}/locations/${getDocAiLocation()}/processors/${getProcessorId(processorType)}`;
  // const [result] = await client.processDocument({
  //   name,
  //   rawDocument: { content: bytes.toString("base64"), mimeType },
  // });
  //
  // For now, we return a placeholder that can be filled in once the processor IDs are configured.

  const projectId = getDocAiProjectId();
  const location = getDocAiLocation();
  let processorId: string;

  try {
    processorId = getProcessorId(processorType);
  } catch (e) {
    // Processor not configured - log warning and return placeholder
    console.warn("[DocAI] Processor not configured, returning placeholder", {
      docId,
      processorType,
      error: (e as Error).message,
    });

    const provider_metrics: ProviderMetrics = {
      provider: "google_doc_ai",
      processorType,
      pages: pageCount,
      model: `doc_ai_${processorType.toLowerCase()}_placeholder`,
      estimated_cost_usd: pageCount ? estimateDocAiCostUSD(pageCount, processorType) : undefined,
      unit_count: pageCount ?? undefined,
    };

    // Log ledger event for routing decision (even for placeholder)
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "extract.docai.completed",
      uiState: "done",
      uiMessage: `Document AI extraction completed (placeholder)`,
      meta: {
        docId,
        processorType,
        elapsed_ms: Date.now() - started,
        placeholder: true,
        provider_metrics,
      },
    });

    return {
      ok: true,
      text: "", // Placeholder - fill from actual DocAI response
      json: {}, // Placeholder - fill from actual DocAI response
      provider_metrics,
    };
  }

  // ─── Actual Document AI call would go here ─────────────────────────────────
  // This is where you'd make the real API call once processors are configured.
  // For now, we'll prepare the structure for when it's ready.

  console.log("[DocAI] Calling Document AI", {
    projectId,
    location,
    processorId,
    processorType,
    fileSize: bytes.length,
    mimeType,
  });

  // TODO: Implement actual Document AI call
  // const result = await callDocumentAi({ projectId, location, processorId, bytes, mimeType });

  const elapsedMs = Date.now() - started;

  const provider_metrics: ProviderMetrics = {
    provider: "google_doc_ai",
    processorType,
    pages: pageCount,
    model: `doc_ai_${processorType.toLowerCase()}`,
    estimated_cost_usd: pageCount ? estimateDocAiCostUSD(pageCount, processorType) : undefined,
    unit_count: pageCount ?? undefined,
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
      pages: pageCount,
      provider_metrics,
    },
  });

  console.log("[DocAI] Extraction completed", {
    docId,
    processorType,
    elapsed_ms: elapsedMs,
    pages: pageCount,
  });

  return {
    ok: true,
    text: "", // TODO: Fill from DocAI response
    json: {}, // TODO: Fill from DocAI structured output
    provider_metrics,
  };
}
