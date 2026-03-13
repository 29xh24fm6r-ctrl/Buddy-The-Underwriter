import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import {
  resolveDocTypeRouting,
  isStructuredExtractionRoute,
  type RoutingClass,
} from "@/lib/documents/docTypeRouting";

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
  structured_assist?: boolean;
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
    original_filename?: string;
    sha256?: string;
  };
  result: ExtractResult;
  provider_metrics?: ProviderMetrics;
};

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
      original_filename,
      sha256
    `)
    .eq("id", docId)
    .single();

  if (error || !doc) {
    console.error("[loadDocumentFromDb] PostgREST error loading deal_document", {
      docId,
      code: error?.code,
      message: error?.message,
      hint: error?.hint,
    });
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

  const pages = ocrResult.pageCount || 1;

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

// ─── Structured Assist (Advisory Only) ──────────────────────────────────────

/**
 * Call Gemini Flash structured assist for V1-eligible doc types.
 *
 * ADVISORY ONLY — this function:
 * - Does NOT write to DB
 * - Does NOT emit facts
 * - Does NOT change classification
 * - Does NOT bind slots
 *
 * Returns null on any failure. Never throws.
 * Deterministic extractors fall back to OCR regex when structured assist is unavailable.
 */
async function tryStructuredAssist(
  ocrText: string,
  canonicalType: string,
  documentId: string,
  doc: ExtractByDocTypeResult["doc"],
): Promise<Record<string, any> | null> {
  void logLedgerEvent({
    dealId: doc.deal_id,
    bankId: doc.bank_id,
    eventKey: "extract.structured.attempted",
    uiState: "working",
    uiMessage: `Structured assist extraction starting`,
    meta: {
      docId: documentId,
      canonicalType,
    },
  });

  try {
    const { extractStructuredAssist } = await import("@/lib/extraction");

    const structured = await extractStructuredAssist({
      ocrText,
      canonicalType,
      documentId,
    });

    if (structured) {
      void logLedgerEvent({
        dealId: doc.deal_id,
        bankId: doc.bank_id,
        eventKey: "extract.structured.completed",
        uiState: "done",
        uiMessage: `Structured assist extraction completed`,
        meta: {
          docId: documentId,
          canonicalType,
          entityCount: structured.entities?.length ?? 0,
          formFieldCount: structured.formFields?.length ?? 0,
          model: structured._meta?.model,
          latencyMs: structured._meta?.latencyMs,
        },
      });

      return structured;
    }

    // Structured assist returned null — unsupported type or empty response
    void logLedgerEvent({
      dealId: doc.deal_id,
      bankId: doc.bank_id,
      eventKey: "extract.structured.failed",
      uiState: "working",
      uiMessage: `Structured assist unavailable — deterministic extractors will use OCR regex`,
      meta: {
        docId: documentId,
        canonicalType,
        reason: "null_response",
      },
    });

    return null;
  } catch (err: any) {
    // Never throw — return null so deterministic extractors fall back to OCR regex
    void logLedgerEvent({
      dealId: doc.deal_id,
      bankId: doc.bank_id,
      eventKey: "extract.structured.failed",
      uiState: "working",
      uiMessage: `Structured assist failed — deterministic extractors will use OCR regex`,
      meta: {
        docId: documentId,
        canonicalType,
        error: err?.message || String(err),
      },
    });

    return null;
  }
}

// ─── Main Router ─────────────────────────────────────────────────────────────

/**
 * Extract document content using the appropriate engine.
 *
 * All documents use Gemini OCR for text extraction. Documents with
 * GEMINI_STRUCTURED routing class also get an advisory structured assist
 * pass via Gemini Flash — this is advisory only and never persists facts
 * directly.
 *
 * Routing is driven by the `routing_class` column on deal_documents:
 *   GEMINI_STRUCTURED → Gemini OCR + advisory structured assist
 *                       (tax returns, income statements, balance sheets, PFS)
 *   GEMINI_PACKET     → Gemini OCR (T12/generic financials)
 *   GEMINI_STANDARD   → Gemini OCR (rent rolls, bank statements, leases, etc.)
 *
 * Falls back to resolveDocTypeRouting() for rows not yet stamped by classifier.
 */
export async function extractByDocType(
  docId: string,
  options?: { forceRefresh?: boolean },
): Promise<ExtractByDocTypeResult> {
  const started = Date.now();

  const doc = await loadDocumentFromDb(docId);
  if (!doc) {
    throw new Error(`doc_not_found: ${docId}`);
  }

  if (!doc.storage_path) {
    throw new Error(`doc_missing_storage_path: ${docId}`);
  }

  // ── Extraction dedup: skip if identical file already has extraction results ──
  // SKIP ENTIRELY when forceRefresh=true — stale v1 cache must not block re-extraction
  if (doc.sha256 && !options?.forceRefresh) {
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
  const useStructuredAssist = isStructuredExtractionRoute(routingClass);

  // Log routing decision
  await logLedgerEvent({
    dealId: doc.deal_id,
    bankId: doc.bank_id,
    eventKey: "extract.routed",
    uiState: "working",
    uiMessage: `Routing document to Gemini OCR${useStructuredAssist ? " + structured assist" : ""}`,
    meta: {
      docId,
      docType: doc.type,
      canonicalType,
      routingClass,
      routingSource: source,
      structuredAssist: useStructuredAssist,
      route: "gemini_ocr",
      provider_metrics: {
        provider: "router",
        route: useStructuredAssist ? "gemini_ocr+structured_assist" : "gemini_ocr",
      },
    },
  });

  console.log("[SmartRouter] Routing extraction", {
    docId,
    docType: doc.type,
    canonicalType,
    routingClass,
    routingSource: source,
    structuredAssist: useStructuredAssist,
    route: "gemini_ocr",
  });

  try {
    // Step 1: Always extract with Gemini OCR
    const { result, provider_metrics } = await extractWithGeminiOcr(doc);

    // Step 2: For structured-eligible types, run advisory structured assist
    // Respects shadow/canary/active mode (H1-H2)
    if (useStructuredAssist && result.fields.extractedText) {
      const { shouldUseStructuredAssistResults, getStructuredAssistMode } = await import(
        "@/lib/extraction/shadowMode"
      );

      const structuredJson = await tryStructuredAssist(
        result.fields.extractedText,
        canonicalType,
        docId,
        doc,
      );

      const assistMode = getStructuredAssistMode();
      const useResults = shouldUseStructuredAssistResults({
        dealId: doc.deal_id,
        bankId: doc.bank_id,
      });

      if (structuredJson && useResults) {
        // Active/canary: use structured assist results
        result.fields.structuredJson = structuredJson;
        provider_metrics.structured_assist = true;
      } else if (structuredJson && !useResults) {
        // Shadow mode: structured assist ran but results are NOT used
        // Emit shadow comparison event for monitoring
        void logLedgerEvent({
          dealId: doc.deal_id,
          bankId: doc.bank_id,
          eventKey: "extract.structured.shadow_result",
          uiState: "done",
          uiMessage: "Structured assist completed (shadow mode — results not used)",
          meta: {
            docId,
            canonicalType,
            mode: assistMode,
            entityCount: structuredJson.entities?.length ?? 0,
            formFieldCount: structuredJson.formFields?.length ?? 0,
            outputHash: structuredJson._meta?.outputHash ?? null,
          },
        });
        provider_metrics.structured_assist = false;
      }
    }

    const elapsedMs = Date.now() - started;

    console.log("[SmartRouter] Extraction completed", {
      docId,
      docType: doc.type,
      routingClass,
      route: "gemini_ocr",
      structuredAssist: !!result.fields.structuredJson,
      elapsed_ms: elapsedMs,
      provider: provider_metrics.provider,
    });

    // Persist Gemini OCR result to document_extracts so extractFactsFromDocument
    // can load structuredJson + extractedText via loadStructuredJson().
    // Without this write, document_extracts stays NULL for all non-dedup docs,
    // forcing the deterministic extractors to fall back to document_ocr_results
    // (which is often short/partial) and producing zero numeric facts.
    try {
      const sb = supabaseAdmin();
      await (sb as any)
        .from("document_extracts")
        .upsert(
          {
            deal_id: doc.deal_id,
            attachment_id: docId,
            provider: provider_metrics.provider ?? "gemini_ocr",
            status: "SUCCEEDED",
            fields_json: result.fields,
            tables_json: result.tables ?? [],
            evidence_json: result.evidence ?? [],
            provider_metrics: provider_metrics,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "attachment_id" },
        );
    } catch (persistErr: any) {
      // Non-fatal — log and continue. extractFactsFromDocument falls back to
      // document_ocr_results if document_extracts is missing.
      console.warn("[SmartRouter] Failed to persist extraction result to document_extracts (non-fatal)", {
        docId,
        error: persistErr?.message,
      });
    }

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
        route: "gemini_ocr",
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
      model: "gemini_vision",
    },
  };
}
