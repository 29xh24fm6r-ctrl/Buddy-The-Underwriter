import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import {
  resolveDocTypeRouting,
  isDocAiRoute,
  type RoutingClass,
} from "@/lib/documents/docTypeRouting";
import { isGoogleDocAiEnabled } from "@/lib/flags/googleDocAi";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExtractResult = {
  fields: Record<string, any>;
  tables: Array<{ name: string; columns: string[]; rows: Array<Array<string | number>> }>;
  evidence: Array<any>;
};

export type ProviderMetrics = {
  provider: string;
  route?: string;
  processorType?: string;
  model?: string;
  pages?: number;
  unit_count?: number;
  estimated_cost_usd?: number;
};

export type ExtractByDocTypeResult = {
  doc: {
    id: string;
    deal_id: string;
    bank_id: string;
    type: string;
    canonical_type: string | null;
    routing_class: RoutingClass | null;
    storage_path: string;
    storage_bucket: string;
    mime_type: string;
    page_count?: number;
    original_filename?: string;
    sha256?: string;
  };
  result: ExtractResult;
  provider_metrics?: ProviderMetrics;
};

// ─── Processor Type ──────────────────────────────────────────────────────────

/**
 * Map canonical type to Document AI processor type.
 * TAX_PROCESSOR for tax returns, FINANCIAL_PROCESSOR for everything else.
 */
function getProcessorType(
  canonicalType: string,
): "TAX_PROCESSOR" | "FINANCIAL_PROCESSOR" {
  const upper = String(canonicalType ?? "").toUpperCase().trim();
  if (upper === "BUSINESS_TAX_RETURN" || upper === "PERSONAL_TAX_RETURN") {
    return "TAX_PROCESSOR";
  }
  return "FINANCIAL_PROCESSOR";
}

// ─── Cost Estimation ─────────────────────────────────────────────────────────

function estimateGeminiCostUSD(pages: number): number {
  const perPage = 0.0025; // $0.0025 per page (estimate)
  return Math.round(pages * perPage * 10000) / 10000;
}

// ─── Document Loading ────────────────────────────────────────────────────────

async function loadDocumentFromDb(
  docId: string,
): Promise<ExtractByDocTypeResult["doc"] | null> {
  const sb = supabaseAdmin();

  const { data: doc, error } = await (sb as any)
    .from("deal_documents")
    .select(`
      id,
      deal_id,
      bank_id,
      document_type,
      canonical_type,
      routing_class,
      storage_path,
      storage_bucket,
      mime_type,
      page_count,
      original_filename,
      sha256
    `)
    .eq("id", docId)
    .single();

  if (error || !doc) {
    return null;
  }

  return {
    id: doc.id,
    deal_id: doc.deal_id,
    bank_id: doc.bank_id,
    type: doc.document_type || "UNKNOWN",
    canonical_type: doc.canonical_type || null,
    routing_class: doc.routing_class || null,
    storage_path: doc.storage_path || "",
    storage_bucket: doc.storage_bucket || "deal-documents",
    mime_type: doc.mime_type || "application/pdf",
    page_count: doc.page_count ?? undefined,
    original_filename: doc.original_filename ?? undefined,
    sha256: doc.sha256 ?? undefined,
  };
}

async function downloadFileBytes(
  storageBucket: string,
  storagePath: string,
): Promise<Buffer> {
  const sb = supabaseAdmin();
  const dl = await sb.storage.from(storageBucket).download(storagePath);

  if (dl.error) {
    throw new Error(`storage_download_failed: ${dl.error.message}`);
  }

  return Buffer.from(await dl.data.arrayBuffer());
}

// ─── Routing Decision ────────────────────────────────────────────────────────

/**
 * Determine the routing class for a document.
 *
 * Priority:
 * 1. Use routing_class from DB if already stamped by classifier
 * 2. Fall back to resolveDocTypeRouting() for pre-migration rows
 */
function resolveRoutingClass(doc: ExtractByDocTypeResult["doc"]): {
  routingClass: RoutingClass;
  canonicalType: string;
  source: "db" | "fallback";
} {
  // Prefer DB-stamped routing_class (set by classify processor)
  if (doc.routing_class && doc.canonical_type) {
    return {
      routingClass: doc.routing_class,
      canonicalType: doc.canonical_type,
      source: "db",
    };
  }

  // Fall back to resolveDocTypeRouting for pre-migration rows
  const { canonical_type, routing_class } = resolveDocTypeRouting(doc.type);
  return {
    routingClass: routing_class,
    canonicalType: canonical_type,
    source: "fallback",
  };
}

// ─── Gemini OCR Path ─────────────────────────────────────────────────────────

async function extractWithGeminiOcr(doc: ExtractByDocTypeResult["doc"]): Promise<{
  result: ExtractResult;
  provider_metrics: ProviderMetrics;
}> {
  const { runGeminiOcrJob } = await import("@/lib/ocr/runGeminiOcrJob");

  const fileBytes = await downloadFileBytes(doc.storage_bucket, doc.storage_path);

  const ocrResult = await runGeminiOcrJob({
    fileBytes,
    mimeType: doc.mime_type,
    fileName: doc.original_filename,
  });

  const pages = ocrResult.pageCount || doc.page_count || 1;

  const provider_metrics: ProviderMetrics = {
    provider: "gemini_ocr",
    model: ocrResult.model,
    pages,
    unit_count: pages,
    estimated_cost_usd: estimateGeminiCostUSD(pages),
  };

  await logLedgerEvent({
    dealId: doc.deal_id,
    bankId: doc.bank_id,
    eventKey: "extract.gemini.completed",
    uiState: "done",
    uiMessage: `Gemini OCR extraction completed`,
    meta: {
      docId: doc.id,
      docType: doc.type,
      pages,
      model: ocrResult.model,
      provider_metrics,
    },
  });

  return {
    result: {
      fields: {
        extractedText: ocrResult.text,
        pageCount: pages,
        model: ocrResult.model,
        docType: doc.type,
      },
      tables: [],
      evidence: [],
    },
    provider_metrics,
  };
}

// ─── Document AI Path ────────────────────────────────────────────────────────

async function extractWithDocumentAi(
  doc: ExtractByDocTypeResult["doc"],
  canonicalType: string,
): Promise<{
  result: ExtractResult;
  provider_metrics: ProviderMetrics;
}> {
  const { extractWithGoogleDocAi } = await import("@/lib/extract/googleDocAi");

  const processorType = getProcessorType(canonicalType);

  const docAiResult = await extractWithGoogleDocAi({
    docId: doc.id,
    dealId: doc.deal_id,
    bankId: doc.bank_id,
    processorType,
    storageBucket: doc.storage_bucket,
    storagePath: doc.storage_path,
  });

  return {
    result: {
      fields: {
        extractedText: docAiResult.text,
        structuredJson: docAiResult.json,
        docType: doc.type,
        processorType,
      },
      tables: [],
      evidence: [],
    },
    provider_metrics: docAiResult.provider_metrics,
  };
}

// ─── Main Router ─────────────────────────────────────────────────────────────

/**
 * Smart Router: Extract document content using the appropriate engine.
 *
 * Routing is driven by the `routing_class` column on deal_documents:
 *   DOC_AI_ATOMIC    → Google Document AI (tax returns, income stmt, balance sheet, PFS)
 *   GEMINI_PACKET    → Gemini OCR (T12/generic financials)
 *   GEMINI_STANDARD  → Gemini OCR (rent rolls, bank statements, leases, insurance, etc.)
 *
 * Falls back to resolveDocTypeRouting() for rows not yet stamped by classifier.
 *
 * LOCKED — do not expand DOC_AI_ATOMIC without explicit approval.
 */
export async function extractByDocType(docId: string): Promise<ExtractByDocTypeResult> {
  const started = Date.now();

  const doc = await loadDocumentFromDb(docId);
  if (!doc) {
    throw new Error(`doc_not_found: ${docId}`);
  }

  if (!doc.storage_path) {
    throw new Error(`doc_missing_storage_path: ${docId}`);
  }

  // ── Extraction dedup: skip if identical file already has extraction results ──
  if (doc.sha256) {
    try {
      const sb = supabaseAdmin();
      const { data: donorDoc } = await (sb as any)
        .from("deal_documents")
        .select("id")
        .eq("bank_id", doc.bank_id)
        .eq("sha256", doc.sha256)
        .neq("id", docId)
        .limit(1)
        .maybeSingle();

      if (donorDoc) {
        const { data: cachedExtract } = await (sb as any)
          .from("document_extracts")
          .select("fields_json, tables_json, evidence_json, provider, provider_metrics")
          .eq("attachment_id", donorDoc.id)
          .eq("status", "SUCCEEDED")
          .maybeSingle();

        if (cachedExtract) {
          console.log("[SmartRouter] Extraction cache hit — reusing from donor doc", {
            docId,
            donorDocId: donorDoc.id,
            sha256: doc.sha256,
          });

          await logLedgerEvent({
            dealId: doc.deal_id,
            bankId: doc.bank_id,
            eventKey: "dedupe.extract_cache.hit",
            uiState: "done",
            uiMessage: "Extraction skipped (reusing cached results from identical file)",
            meta: {
              doc_id: docId,
              donor_doc_id: donorDoc.id,
              sha256: doc.sha256,
              provider: cachedExtract.provider,
            },
          });

          // Save the reused extraction results for THIS document
          await (sb as any).from("document_extracts").upsert(
            {
              deal_id: doc.deal_id,
              attachment_id: docId,
              provider: "sha256_dedup",
              status: "SUCCEEDED",
              fields_json: cachedExtract.fields_json,
              tables_json: cachedExtract.tables_json,
              evidence_json: cachedExtract.evidence_json,
              provider_metrics: {
                provider: "sha256_dedup",
                donor_doc_id: donorDoc.id,
                original_provider: cachedExtract.provider,
              },
              updated_at: new Date().toISOString(),
            },
            { onConflict: "attachment_id" },
          );

          return {
            doc,
            result: {
              fields: cachedExtract.fields_json ?? {},
              tables: cachedExtract.tables_json ?? [],
              evidence: cachedExtract.evidence_json ?? [],
            },
            provider_metrics: {
              provider: "sha256_dedup",
              route: "cache",
            },
          };
        }
      }
    } catch (dedupErr: any) {
      console.warn("[SmartRouter] Extraction dedup check failed (non-fatal)", dedupErr?.message);
    }
  }
  // ── End extraction dedup ────────────────────────────────────────────────────

  const { routingClass, canonicalType, source } = resolveRoutingClass(doc);
  const docAiEnabled = isGoogleDocAiEnabled();
  const wouldUseDocAi = isDocAiRoute(routingClass);
  const useDocAi = wouldUseDocAi && docAiEnabled;
  const route = useDocAi ? "docai" : "gemini_ocr";
  const fallbackReason = wouldUseDocAi && !docAiEnabled ? "docai_disabled" : undefined;

  // Log routing decision
  await logLedgerEvent({
    dealId: doc.deal_id,
    bankId: doc.bank_id,
    eventKey: "extract.routed",
    uiState: "working",
    uiMessage: `Routing document to ${useDocAi ? "Document AI" : "Gemini OCR"}`,
    meta: {
      docId,
      docType: doc.type,
      canonicalType,
      routingClass,
      routingSource: source,
      docaiEnabled: docAiEnabled,
      fallbackReason,
      route,
      provider_metrics: {
        provider: "router",
        intended_route: wouldUseDocAi ? "docai" : "gemini_ocr",
        actual_route: route,
        docai_enabled: docAiEnabled,
      },
    },
  });

  console.log("[SmartRouter] Routing extraction", {
    docId,
    docType: doc.type,
    canonicalType,
    routingClass,
    routingSource: source,
    docaiEnabled: docAiEnabled,
    fallbackReason,
    route,
  });

  try {
    const { result, provider_metrics } = useDocAi
      ? await extractWithDocumentAi(doc, canonicalType)
      : await extractWithGeminiOcr(doc);

    const elapsedMs = Date.now() - started;

    console.log("[SmartRouter] Extraction completed", {
      docId,
      docType: doc.type,
      routingClass,
      route,
      elapsed_ms: elapsedMs,
      provider: provider_metrics.provider,
    });

    return { doc, result, provider_metrics };
  } catch (error: any) {
    await logLedgerEvent({
      dealId: doc.deal_id,
      bankId: doc.bank_id,
      eventKey: "extract.failed",
      uiState: "error",
      uiMessage: `Extraction failed: ${error?.message || "Unknown error"}`,
      meta: {
        docId,
        docType: doc.type,
        routingClass,
        route,
        error: error?.message || String(error),
        elapsed_ms: Date.now() - started,
      },
    });

    throw error;
  }
}

// ─── Legacy Compatibility ────────────────────────────────────────────────────

/**
 * Legacy extraction using hybrid financials extractor.
 * Kept for backwards compatibility with existing FINANCIALS extraction.
 */
export async function extractFinancialsLegacy(
  docId: string,
  azureOcrJson?: unknown,
): Promise<ExtractByDocTypeResult> {
  const doc = await loadDocumentFromDb(docId);
  if (!doc) {
    throw new Error(`doc_not_found: ${docId}`);
  }

  const { extractFinancialsHybrid } = await import("@/lib/extract/financialsHybrid");

  const result = await extractFinancialsHybrid({
    filePath: doc.storage_path,
    docId: doc.id,
    docName: doc.original_filename || doc.storage_path,
    azureOcrJson: azureOcrJson as any,
  });

  return {
    doc,
    result,
    provider_metrics: {
      provider: "hybrid_financials",
      model: "claude_vision_hybrid",
    },
  };
}
