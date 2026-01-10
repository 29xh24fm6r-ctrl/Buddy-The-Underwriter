import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { analyzeDocument } from "@/lib/docIntel/engine";
import { autoMatchChecklistFromFilename } from "@/lib/deals/autoMatchChecklistFromFilename";
import { inferDocumentMetadata } from "@/lib/documents/inferDocumentMetadata";
import { reconcileDealChecklist } from "@/lib/checklist/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mkReqId() {
  try {
    // Node 20+ (Vercel) supports crypto.randomUUID()
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

const BodySchema = z
  .object({
    documentId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(25).optional(),
    scanLimit: z.number().int().min(25).max(500).optional(),
    fast: z.boolean().optional(),
    preferPdfText: z.boolean().optional(),
    minPdfTextChars: z.number().int().min(50).max(20000).optional(),
    // Performance: allow limiting Azure DI to first pages (e.g. 1-2) for quick classification.
    maxPages: z.number().int().min(1).max(20).optional(),
  })
  .optional();

async function extractTextWithPdfParse(bytes: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const pdfParse = (mod as any).default ?? (mod as any);
  const out = await pdfParse(bytes);
  const text = typeof out?.text === "string" ? out.text : "";
  return text;
}

function looksUsefulForTaxClassification(text: string): boolean {
  const s = (text || "").toLowerCase();
  if (!s) return false;
  // A small text layer is still enough if it includes these strong signals.
  return (
    s.includes("form 1120") ||
    s.includes("1120s") ||
    s.includes("1120-s") ||
    s.includes("form 1040") ||
    s.includes("form 1065") ||
    s.includes("schedule k-1") ||
    s.includes("k-1")
  );
}

async function extractTextSmart(args: {
  bytes: Buffer;
  mimeType: string | null;
  preferPdfText: boolean;
  minPdfTextChars: number;
  azureModel: "prebuilt-read" | "prebuilt-layout";
  azurePages?: string;
}): Promise<{ text: string; source: "pdf_text" | "azure_di" }>{
  const mt = String(args.mimeType || "").toLowerCase();
  if (args.preferPdfText && mt === "application/pdf") {
    try {
      const t = await extractTextWithPdfParse(args.bytes);
      const trimmedLen = (t || "").trim().length;
      if (trimmedLen >= args.minPdfTextChars || looksUsefulForTaxClassification(t)) {
        return { text: t, source: "pdf_text" };
      }
    } catch {
      // Fall through to Azure DI
    }
  }

  const t = await extractTextWithAzureDI(args.bytes, {
    model: args.azureModel,
    pages: args.azurePages,
  });
  return { text: t, source: "azure_di" };
}

async function extractTextWithAzureDI(
  bytes: Buffer,
  opts?: { model?: "prebuilt-read" | "prebuilt-layout"; pages?: string },
): Promise<string> {
  // 🚀 CLAUDE OCR: Use Claude if enabled
  if (process.env.USE_CLAUDE_OCR === "true") {
    const { runClaudeOcrJob } = await import("@/lib/ocr/runClaudeOcrJob");
    const result = await runClaudeOcrJob({
      fileBytes: bytes,
      mimeType: "application/pdf",
      fileName: "document.pdf",
    });
    return result.text;
  }

  // 🔵 AZURE DI OCR: Fallback to Azure Document Intelligence
  const endpoint =
    process.env.AZURE_DI_ENDPOINT ||
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ||
    "";
  const apiKey =
    process.env.AZURE_DI_KEY ||
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY ||
    "";

  if (!endpoint || !apiKey) {
    throw new Error(
      "Missing Azure DI env vars. Set AZURE_DI_ENDPOINT/AZURE_DI_KEY (or AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT/AZURE_DOCUMENT_INTELLIGENCE_KEY).",
    );
  }

  const { AzureKeyCredential, DocumentAnalysisClient } = await import(
    "@azure/ai-form-recognizer"
  );

  const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey));
  const model = opts?.model ?? "prebuilt-layout";
  const pages = typeof opts?.pages === "string" && opts.pages.trim() ? opts.pages.trim() : undefined;

  // Limiting pages can drastically reduce latency on long PDFs.
  const poller = await client.beginAnalyzeDocument(model, bytes, pages ? ({ pages } as any) : undefined);
  const analyzeResult = await poller.pollUntilDone();

  const content = typeof (analyzeResult as any)?.content === "string" ? (analyzeResult as any).content : "";
  return content;
}

async function extractTextWithAzureDIFromUrl(
  url: string,
  opts?: { model?: "prebuilt-read" | "prebuilt-layout"; pages?: string },
): Promise<string> {
  const endpoint =
    process.env.AZURE_DI_ENDPOINT ||
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ||
    "";
  const apiKey =
    process.env.AZURE_DI_KEY ||
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY ||
    "";

  if (!endpoint || !apiKey) {
    throw new Error(
      "Missing Azure DI env vars. Set AZURE_DI_ENDPOINT/AZURE_DI_KEY (or AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT/AZURE_DOCUMENT_INTELLIGENCE_KEY).",
    );
  }

  const { AzureKeyCredential, DocumentAnalysisClient } = await import(
    "@azure/ai-form-recognizer"
  );

  const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey));
  const model = opts?.model ?? "prebuilt-layout";
  const pages = typeof opts?.pages === "string" && opts.pages.trim() ? opts.pages.trim() : undefined;

  const poller = await (client as any).beginAnalyzeDocumentFromUrl(
    model,
    url,
    pages ? ({ pages } as any) : undefined,
  );
  const analyzeResult = await poller.pollUntilDone();

  const content =
    typeof (analyzeResult as any)?.content === "string" ? (analyzeResult as any).content : "";
  return content;
}

async function startOrResumeAzurePollerFromUrl(args: {
  url: string;
  model: "prebuilt-read" | "prebuilt-layout";
  pages?: string;
  resumeFrom?: string | null;
}) {
  const endpoint =
    process.env.AZURE_DI_ENDPOINT ||
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ||
    "";
  const apiKey =
    process.env.AZURE_DI_KEY ||
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY ||
    "";

  if (!endpoint || !apiKey) {
    throw new Error(
      "Missing Azure DI env vars. Set AZURE_DI_ENDPOINT/AZURE_DI_KEY (or AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT/AZURE_DOCUMENT_INTELLIGENCE_KEY).",
    );
  }

  const { AzureKeyCredential, DocumentAnalysisClient } = await import(
    "@azure/ai-form-recognizer"
  );

  const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey));
  const pages = typeof args.pages === "string" && args.pages.trim() ? args.pages.trim() : undefined;

  const options: any = {
    updateIntervalInMs: 2000,
  };
  if (pages) options.pages = pages;
  if (args.resumeFrom) options.resumeFrom = args.resumeFrom;

  const poller = await (client as any).beginAnalyzeDocumentFromUrl(
    args.model,
    args.url,
    options,
  );

  return poller;
}

async function pollAzurePollerForContent(args: {
  poller: any;
  maxPollMs: number;
}): Promise<{ done: boolean; content: string; resumeFrom: string | null }> {
  const started = Date.now();
  const poller = args.poller;

  while (!poller.isDone() && Date.now() - started < args.maxPollMs) {
    await poller.poll();
    if (!poller.isDone()) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const resumeFrom = typeof poller.toString === "function" ? poller.toString() : null;

  if (!poller.isDone()) {
    return { done: false, content: "", resumeFrom };
  }

  const analyzeResult = await poller.pollUntilDone();
  const content =
    typeof (analyzeResult as any)?.content === "string" ? (analyzeResult as any).content : "";
  return { done: true, content, resumeFrom };
}

async function bestEffortUpsertOcrPollerState(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  dealId: string;
  fileId: string;
  azureModel: string;
  azurePages?: string;
  resumeFrom: string | null;
  status: "running" | "queued" | "done" | "failed";
  note?: string;
}) {
  const { sb, dealId, fileId, azureModel, azurePages, resumeFrom, status, note } = args;

  const up = await sb.from("doc_intel_results").upsert(
    {
      deal_id: dealId,
      file_id: fileId,
      doc_type: "Unknown",
      tax_year: null,
      extracted_json: {
        source: "azure_di_ocr",
        azure_model: azureModel,
        azure_pages: azurePages ?? null,
        azure_pages_end: parseAzurePagesEnd(azurePages),
        azure_resumeFrom: resumeFrom ?? null,
        ocr_status: status,
        note: note ?? null,
      },
      quality_json: {
        legible: null,
        complete: null,
        signed: null,
        notes: ["ocr_poller_state_only"],
      },
      confidence: null,
      evidence_json: { evidence_spans: [], evidence: [] },
      created_at: new Date().toISOString(),
    } as any,
    { onConflict: "deal_id,file_id" },
  );

  if (up.error) {
    console.error("[documents/intel/run] ocr_poller_state_upsert_failed (non-fatal)", {
      dealId,
      fileId,
      error: up.error,
    });
  }
}

function parseAzurePagesEnd(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (!m) return null;
  const end = Number(m[2]);
  return Number.isFinite(end) ? end : null;
}

type DocTypeBucket = "business_tax_return" | "personal_tax_return";

function normalizeAiDocTypeToBucket(aiDocTypeRaw: unknown): DocTypeBucket | null {
  const s = String(aiDocTypeRaw ?? "").toLowerCase();
  if (!s) return null;

  // Business tax return signals
  if (
    s.includes("form 1120") ||
    s.includes("1120s") ||
    s.includes("1120-s") ||
    s.includes("form 1065") ||
    s.includes("1065") ||
    s.includes("schedule k-1") ||
    s.includes("k-1")
  ) {
    return "business_tax_return";
  }

  // Personal tax return signals
  if (
    s.includes("form 1040") ||
    s.includes("1040") ||
    s.includes("personal tax")
  ) {
    return "personal_tax_return";
  }

  if (s.includes("tax return")) {
    // Ambiguous, avoid forcing a bucket.
    return null;
  }

  return null;
}

function parseTaxYearToNumber(taxYearRaw: unknown): number | null {
  const s = String(taxYearRaw ?? "").trim();
  if (!s) return null;
  const m = s.match(/\b(20[0-3][0-9])\b/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 2000 || n > 2039) return null;
  return n;
}

function mergeYears(primary: number | null, years: number[] | null): {
  doc_year: number | null;
  doc_years: number[] | null;
} {
  const set = new Set<number>();
  if (Number.isFinite(primary as any)) set.add(Number(primary));
  if (Array.isArray(years)) {
    for (const y of years) {
      const n = Number(y);
      if (Number.isFinite(n)) set.add(n);
    }
  }
  const merged = Array.from(set).sort((a, b) => b - a);
  return {
    doc_year: merged.length ? merged[0] : null,
    doc_years: merged.length ? merged : null,
  };
}

async function bestEffortStampDealDocument(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  docId: string;
  filename: string;
  extractedText?: string;
  aiDocType?: unknown;
  aiTaxYear?: unknown;
  aiConfidence?: unknown;
}) {
  const { sb, docId, filename: _filename, extractedText, aiDocType, aiTaxYear, aiConfidence } =
    args;

  const meta = inferDocumentMetadata({
    // Do not rely on borrower-provided filenames for classification.
    originalFilename: null,
    extractedText: extractedText ?? null,
  });

  const bucketFromAi = normalizeAiDocTypeToBucket(aiDocType);
  const bucketFromDeterministic =
    meta.document_type !== "unknown" ? meta.document_type : null;
  const documentType = (bucketFromAi ?? bucketFromDeterministic) as
    | DocTypeBucket
    | null;

  const taxYear = parseTaxYearToNumber(aiTaxYear);
  const mergedYears = mergeYears(taxYear, meta.doc_years);

  // Normalize confidence to 0..1 when possible.
  const aiConfNum = Number(aiConfidence);
  const aiConf01 =
    Number.isFinite(aiConfNum) && aiConfNum > 1 ? aiConfNum / 100 : aiConfNum;
  const confidence = Math.max(
    Number(meta.confidence ?? 0) || 0,
    Number.isFinite(aiConf01) ? Math.max(0, Math.min(1, aiConf01)) : 0,
  );

  const reasonParts = [
    bucketFromAi ? `ai_bucket:${bucketFromAi}` : null,
    taxYear ? `ai_tax_year:${taxYear}` : null,
    meta.reason ? `det:${meta.reason}` : null,
  ].filter(Boolean);
  const matchReason = reasonParts.join(" | ");

  // Nothing to stamp.
  if (!documentType && !mergedYears.doc_year && !mergedYears.doc_years) return;

  // Best-effort update: tolerate schema drift.
  const attempt1 = await sb
    .from("deal_documents")
    .update({
      document_type: documentType,
      doc_year: mergedYears.doc_year,
      doc_years: mergedYears.doc_years,
      match_confidence: confidence,
      match_reason: matchReason,
      match_source: "ocr_ai",
    } as any)
    .eq("id", docId);

  if (!attempt1.error) return;

  const msg = String(attempt1.error.message || "");
  if (
    msg.toLowerCase().includes("does not exist") &&
    (msg.includes("doc_years") || msg.includes("document_type"))
  ) {
    await sb
      .from("deal_documents")
      .update({
        doc_year: mergedYears.doc_year,
        match_confidence: confidence,
        match_reason: matchReason,
        match_source: "ocr_ai",
      } as any)
      .eq("id", docId);
    return;
  }

  // If it's another error, treat as non-fatal (this route is best-effort).
  console.error("[documents/intel/run] stamp_failed", {
    docId,
    error: attempt1.error,
  });
}

function toDocIntelDocType(metaType: string): string {
  // Keep values compatible with checklistKeysFromDocIntel() which normalizes and
  // matches based on BUSINESS/TAX and PERSONAL/TAX tokens.
  if (metaType === "business_tax_return") return "business_tax_return";
  if (metaType === "personal_tax_return") return "personal_tax_return";
  return "Unknown";
}

async function bestEffortUpsertDocIntelFromOcr(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  dealId: string;
  fileId: string;
  extractedText: string;
  azureModel?: string;
  azurePages?: string;
}) {
  const { sb, dealId, fileId, extractedText, azureModel, azurePages } = args;

  const meta = inferDocumentMetadata({
    originalFilename: null,
    extractedText: extractedText ?? null,
  });

  const docType = toDocIntelDocType(meta.document_type);
  const confidence = Math.max(
    0,
    Math.min(100, Math.round((Number(meta.confidence ?? 0) || 0) * 100)),
  );

  const taxYear = meta.doc_year ?? null;

  // Even if Unknown, persist so downstream screens can see OCR happened.
  // Auto-match will only trust non-Unknown + confidence >= 60.
  const up = await sb.from("doc_intel_results").upsert(
    {
      deal_id: dealId,
      file_id: fileId,
      doc_type: docType,
      tax_year: taxYear,
      extracted_json: {
        source: "azure_di_ocr",
        text_len: (extractedText || "").length,
        azure_model: azureModel ?? null,
        azure_pages: azurePages ?? null,
        azure_pages_end: parseAzurePagesEnd(azurePages),
        det: {
          document_type: meta.document_type,
          doc_year: meta.doc_year,
          doc_years: meta.doc_years,
          confidence: meta.confidence,
          reason: meta.reason,
        },
      },
      quality_json: {
        legible: null,
        complete: null,
        signed: null,
        notes: ["deterministic_ocr_only"],
      },
      confidence,
      evidence_json: { evidence_spans: [], evidence: [] },
      created_at: new Date().toISOString(),
    } as any,
    { onConflict: "deal_id,file_id" },
  );

  if (up.error) {
    console.error("[documents/intel/run] ocr_doc_intel_upsert_failed (non-fatal)", {
      dealId,
      fileId,
      error: up.error,
    });
  }
}

/**
 * POST /api/deals/[dealId]/documents/intel/run
 *
 * Best-effort: For one document or a small batch, download from storage, run Azure DI OCR,
 * run doc-intel (OpenAI JSON), persist into doc_intel_results, then auto-match checklist.
 */
async function runIntelForDeal(args: {
  req: NextRequest;
  dealId: string;
  documentId: string | null;
  limit: number;
  scanLimit?: number;
  fast?: boolean;
  preferPdfText?: boolean;
  minPdfTextChars?: number;
  maxPages?: number;
}) {
  const {
    dealId,
    documentId,
    limit,
    scanLimit,
    fast,
    preferPdfText,
    minPdfTextChars,
    maxPages,
  } = args;

  const reqId = mkReqId();
  const startedAll = Date.now();
  console.info("[doc_intel_run] start", {
    reqId,
    dealId,
    documentId,
    limit,
    scanLimit,
    fast: !!fast,
    preferPdfText: preferPdfText !== false,
    minPdfTextChars: Number(minPdfTextChars ?? 0) || null,
    maxPages: typeof maxPages === "number" ? maxPages : null,
  });

  const sb = supabaseAdmin();

  const isTrustedExistingIntel = (row: any) => {
    if (!row) return false;
    const dt = String(row.doc_type || "").trim().toLowerCase();
    if (!dt || dt === "unknown") return false;
    const conf =
      typeof row.confidence === "number" ? Number(row.confidence) : null;
    return conf == null || conf >= 60;
  };

  const selectColsWithBucket =
    "id, storage_bucket, storage_path, original_filename, mime_type, created_at";
  const selectColsNoBucket =
    "id, storage_path, original_filename, mime_type, created_at";

  // Load docs that still need processing (not just latest N).
  // This avoids getting stuck repeatedly scanning already-processed newest files.
  let docs: any[] = [];
  let docsErr: any = null;

  if (documentId) {
    // Single-document mode
    const attempt1 = await sb
      .from("deal_documents")
      .select(selectColsWithBucket)
      .eq("deal_id", dealId)
      .eq("id", documentId)
      .limit(1);

    docs = attempt1.data as any;
    docsErr = attempt1.error;

    if (
      docsErr &&
      String(docsErr.message || "")
        .toLowerCase()
        .includes("storage_bucket")
    ) {
      const retry = await sb
        .from("deal_documents")
        .select(selectColsNoBucket)
        .eq("deal_id", dealId)
        .eq("id", documentId)
        .limit(1);
      docs = retry.data as any;
      docsErr = retry.error;
    }
  } else {
    const maxScan = Math.max(25, Math.min(500, Number(scanLimit ?? 200) || 200));
    const pageSize = Math.min(200, maxScan); // Increased from 50 to scan more docs at once
    let scanned = 0;
    let lastCreatedAt: string | null = null;
    let includeBucket = true;

    while (docs.length < limit && scanned < maxScan) {
      let q = sb
        .from("deal_documents")
        .select(includeBucket ? selectColsWithBucket : selectColsNoBucket)
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(pageSize);

      if (lastCreatedAt) {
        q = q.lt("created_at", lastCreatedAt);
      }

      const pageRes = await q;
      if (
        pageRes.error &&
        includeBucket &&
        String(pageRes.error.message || "")
          .toLowerCase()
          .includes("storage_bucket")
      ) {
        // Back-compat: tolerate older schemas where deal_documents.storage_bucket may not exist.
        includeBucket = false;
        continue;
      }

      if (pageRes.error) {
        docsErr = pageRes.error;
        break;
      }

      const page = (pageRes.data as any[]) ?? [];
      if (page.length === 0) break;
      scanned += page.length;
      lastCreatedAt = String(page[page.length - 1]?.created_at || "") || null;

      // Prefetch intel for this page to avoid N queries.
      const ids = page.map((d) => String(d.id)).filter(Boolean);
      const intelRes = await sb
        .from("doc_intel_results")
        .select("file_id, doc_type, confidence, extracted_json")
        .eq("deal_id", dealId)
        .in("file_id", ids);

      const intelMap = new Map<string, any>();
      for (const r of (intelRes.data as any[]) ?? []) {
        intelMap.set(String(r.file_id), r);
      }

      const candidates: any[] = [];
      for (const d of page) {
        const id = String(d.id);
        const intel = intelMap.get(id) ?? null;
        if (!isTrustedExistingIntel(intel)) {
          candidates.push({ doc: d, intel });
        }
      }

      // Throughput vs completion:
      // - In non-fast mode, prioritize resuming in-progress Azure OCR to finish a doc ASAP.
      // - In fast mode, interleave (resume a few + start new ones) so large packages kick off
      //   multiple Azure jobs instead of serializing behind a single long PDF.
      if (!fast) {
        candidates.sort((a, b) => {
          const ar = a?.intel?.extracted_json?.azure_resumeFrom ? 1 : 0;
          const br = b?.intel?.extracted_json?.azure_resumeFrom ? 1 : 0;
          return br - ar;
        });

        for (const c of candidates) {
          if (docs.length >= limit) break;
          docs.push(c.doc);
        }
      } else {
        const running: any[] = [];
        const fresh: any[] = [];
        for (const c of candidates) {
          if (c?.intel?.extracted_json?.azure_resumeFrom) running.push(c);
          else fresh.push(c);
        }

        const remainingSlots = Math.max(0, limit - docs.length);
        // Aim to resume up to ~1/3 of slots (min 1 if any running), then start new.
        const resumeQuota = Math.min(
          running.length,
          Math.max(1, Math.floor(remainingSlots / 3)),
        );

        const chosen: any[] = [];
        chosen.push(...running.slice(0, resumeQuota));
        chosen.push(...fresh.slice(0, Math.max(0, remainingSlots - chosen.length)));
        if (chosen.length < remainingSlots) {
          chosen.push(...running.slice(resumeQuota, resumeQuota + (remainingSlots - chosen.length)));
        }

        for (const c of chosen) {
          if (docs.length >= limit) break;
          docs.push(c.doc);
        }
      }
    }
  }

  if (docsErr) {
    return NextResponse.json(
      { ok: false, error: "Failed to load deal documents", details: docsErr },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  const list = docs ?? [];
  if (list.length === 0) {
    // Still return totals so the UI can show "0 remaining" vs "nothing eligible".
    const { count: totalDocs } = await sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    const { count: trustedDocs } = await sb
      .from("doc_intel_results")
      .select("file_id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .neq("doc_type", "Unknown")
      .or("confidence.is.null,confidence.gte.60");

    const t = Number(totalDocs ?? 0) || 0;
    const trusted = Number(trustedDocs ?? 0) || 0;
    const remaining = Math.max(0, t - trusted);

    return NextResponse.json(
      {
        ok: true,
        reqId,
        dealId,
        status: remaining === 0 ? "complete" : "partial",
        totals: { totalDocs: t, trustedDocs: trusted, remainingDocs: remaining },
        processed: 0,
        analyzed: 0,
        matched: 0,
        updated: 0,
        stamped: 0,
        results: [],
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  let analyzed = 0;
  let matched = 0;
  let updated = 0;
  let stamped = 0;

  const results: Array<{
    document_id: string;
    filename: string;
    ocr: "skipped" | "ok" | "running" | "error";
    doc_intel: "skipped" | "ok" | "error";
    matched_keys: string[];
    updated_items: number;
    error?: string;
  }> = [];

  async function processOne(doc: any) {
    const docId = String(doc.id);
    const filename = String(doc.original_filename || "");

    const startedOne = Date.now();

    const stat = { analyzed: 0, matched: 0, updated: 0, stamped: 0 };

    try {
      // If doc_intel already exists, skip heavy work.
      // Selection should already prefer untrusted docs, but keep this for safety.
      const existingIntel = await sb
        .from("doc_intel_results")
        .select("id, doc_type, tax_year, confidence, extracted_json")
        .eq("deal_id", dealId)
        .eq("file_id", docId)
        .maybeSingle();

      if (!existingIntel.error && !!existingIntel.data?.id && isTrustedExistingIntel(existingIntel.data)) {
        console.info("[doc_intel_run] skip_trusted", {
          reqId,
          dealId,
          docId,
          ms: Date.now() - startedOne,
        });
        await bestEffortStampDealDocument({
          sb,
          docId,
          filename,
          aiDocType: (existingIntel.data as any)?.doc_type,
          aiTaxYear: (existingIntel.data as any)?.tax_year,
          aiConfidence: (existingIntel.data as any)?.confidence,
        });
        stat.stamped += 1;

        const m = await autoMatchChecklistFromFilename({ dealId, filename, fileId: docId });
        stat.matched += m.matched.length;
        stat.updated += m.updated;

        return {
          stat,
          result: {
            document_id: docId,
            filename,
            ocr: "skipped" as const,
            doc_intel: "skipped" as const,
            matched_keys: m.matched,
            updated_items: m.updated,
          },
        };
      }

      // Download bytes from storage
      const storagePath = String(doc.storage_path || "");
      if (!storagePath) {
        return {
          stat,
          result: {
            document_id: docId,
            filename,
            ocr: "error" as const,
            doc_intel: "error" as const,
            matched_keys: [],
            updated_items: 0,
            error: "Missing storage_path",
          },
        };
      }

      const storageBucket = String((doc as any)?.storage_bucket || "deal-files");

      // Fast mode: avoid downloading large files into Vercel whenever possible.
      // Prefer Azure DI from a short-lived signed URL, and only download as a fallback.
      const effectiveFast = !!fast;

      const windowPages =
        typeof maxPages === "number" && Number.isFinite(maxPages)
          ? Math.max(1, Math.min(20, Math.floor(maxPages)))
          : effectiveFast
            ? 10
            : null;

      // Progressive scanning for cover sheets: if we already OCR'd pages 1-10 and got Unknown,
      // next run scans 11-20, etc.
      const prevPagesEnd = parseAzurePagesEnd((existingIntel.data as any)?.extracted_json?.azure_pages) ??
        Number((existingIntel.data as any)?.extracted_json?.azure_pages_end ?? null);
      const startPage = windowPages && Number.isFinite(prevPagesEnd as any) ? Math.max(1, Number(prevPagesEnd) + 1) : 1;
      const endPage = windowPages ? Math.min(50, startPage + windowPages - 1) : null;
      const azurePages = endPage ? `${startPage}-${endPage}` : undefined;

      const azureModel: "prebuilt-read" | "prebuilt-layout" =
        effectiveFast ? "prebuilt-read" : "prebuilt-layout";

      let extractedText = "";
      let extractSource: "signed_url_azure" | "download_smart" | null = null;
      let smartSource: "pdf_text" | "azure_di" | null = null;
      try {
        let usedUrl = false;

        // 🚀 GEMINI OCR: Use Gemini if enabled (priority over Mistral/Claude)
        if (process.env.USE_GEMINI_OCR === "true" && effectiveFast && !extractedText) {
          console.log("[INTEL_RUN] Using Gemini OCR for fast mode", { docId, filename });
          const { data: fileData, error: dlError } = await sb.storage
            .from(storageBucket)
            .download(storagePath);

          if (!dlError && fileData) {
            const bytes = Buffer.from(await fileData.arrayBuffer());
            const { runGeminiOcrJob } = await import("@/lib/ocr/runGeminiOcrJob");
            const geminiStart = Date.now();
            const result = await runGeminiOcrJob({
              fileBytes: bytes,
              mimeType: "application/pdf",
              fileName: filename || "document.pdf",
            });
            console.log("[INTEL_RUN] Gemini OCR completed", {
              docId,
              filename,
              elapsed_ms: Date.now() - geminiStart,
              textLength: result.text.length,
            });
            extractedText = result.text;
            usedUrl = true;
            extractSource = "signed_url_azure"; // Keep same tracking for now
          } else {
            console.log("[INTEL_RUN] Failed to download for Gemini OCR", { docId, error: dlError });
          }
        }
        
        // 🚀 MISTRAL OCR: Use Mistral if enabled (priority over Claude)
        if (process.env.USE_MISTRAL_OCR === "true" && effectiveFast && !extractedText) {
          console.log("[INTEL_RUN] Using Mistral OCR for fast mode", { docId, filename });
          const { data: fileData, error: dlError } = await sb.storage
            .from(storageBucket)
            .download(storagePath);
          
          if (!dlError && fileData) {
            const bytes = Buffer.from(await fileData.arrayBuffer());
            const { runMistralOcrJob } = await import("@/lib/ocr/runMistralOcrJob");
            const mistralStart = Date.now();
            const result = await runMistralOcrJob({
              fileBytes: bytes,
              mimeType: "application/pdf",
              fileName: filename || "document.pdf",
            });
            console.log("[INTEL_RUN] Mistral OCR completed", { 
              docId, 
              filename, 
              elapsed_ms: Date.now() - mistralStart,
              textLength: result.text.length 
            });
            extractedText = result.text;
            usedUrl = true;
            extractSource = "signed_url_azure"; // Keep same tracking for now
          } else {
            console.log("[INTEL_RUN] Failed to download for Mistral OCR", { docId, error: dlError });
          }
        }
        
        // 🚀 CLAUDE OCR: Use Claude if enabled (faster than signed URL + Azure DI)
        if (process.env.USE_CLAUDE_OCR === "true" && effectiveFast && !extractedText) {
          console.log("[INTEL_RUN] Using Claude OCR for fast mode", { docId, filename });
          const { data: fileData, error: dlError } = await sb.storage
            .from(storageBucket)
            .download(storagePath);
          
          if (!dlError && fileData) {
            const bytes = Buffer.from(await fileData.arrayBuffer());
            const { runClaudeOcrJob } = await import("@/lib/ocr/runClaudeOcrJob");
            const claudeStart = Date.now();
            const result = await runClaudeOcrJob({
              fileBytes: bytes,
              mimeType: "application/pdf",
              fileName: filename || "document.pdf",
            });
            console.log("[INTEL_RUN] Claude OCR completed", { 
              docId, 
              filename, 
              elapsed_ms: Date.now() - claudeStart,
              textLength: result.text.length 
            });
            extractedText = result.text;
            usedUrl = true;
            extractSource = "signed_url_azure"; // Keep same tracking for now
          } else {
            console.log("[INTEL_RUN] Failed to download for Claude OCR", { docId, error: dlError });
          }
        } else {
          console.log("[INTEL_RUN] Claude OCR check", { 
            USE_CLAUDE_OCR: process.env.USE_CLAUDE_OCR,
            effectiveFast 
          });
        }
        
        if (!usedUrl && effectiveFast) {
          const signed = await sb.storage
            .from(storageBucket)
            .createSignedUrl(storagePath, 60 * 10);

          if (!signed.error && signed.data?.signedUrl) {
            const resumeFrom: string | null =
              (existingIntel.data as any)?.extracted_json?.azure_resumeFrom ?? null;

            const poller = await startOrResumeAzurePollerFromUrl({
              url: signed.data.signedUrl,
              model: azureModel,
              pages: azurePages,
              resumeFrom,
            });

            // Poll briefly so the request returns quickly even if Azure takes minutes.
            // Keep this short to avoid serializing large packages behind a single long OCR.
            const polled = await pollAzurePollerForContent({
              poller,
              maxPollMs: 2500,
            });

            if (!polled.done) {
              await bestEffortUpsertOcrPollerState({
                sb,
                dealId,
                fileId: docId,
                azureModel,
                azurePages,
                resumeFrom: polled.resumeFrom,
                status: "running",
                note: "azure_di_running",
              });

              console.info("[doc_intel_run] ocr_running", {
                reqId,
                dealId,
                docId,
                fast: true,
                azureModel,
                azurePages: azurePages ?? null,
                resumeFrom: polled.resumeFrom ? "present" : null,
                ms: Date.now() - startedOne,
              });

              return {
                stat,
                result: {
                  document_id: docId,
                  filename,
                  ocr: "running" as const,
                  doc_intel: "skipped" as const,
                  matched_keys: [],
                  updated_items: 0,
                },
              };
            }

            extractedText = polled.content;
            usedUrl = true;
            extractSource = "signed_url_azure";
          }
        }

        if (!usedUrl) {
          // Fallback: download bytes and use smart extraction (PDF text when available).
          const dl = await sb.storage.from(storageBucket).download(storagePath);
          if (dl.error || !dl.data) {
            throw new Error(
              `Storage download failed (${storageBucket}): ${dl.error?.message || "unknown"}`,
            );
          }

          const bytes = Buffer.from(await dl.data.arrayBuffer());
          const ext = await extractTextSmart({
            bytes,
            mimeType: (doc as any)?.mime_type ?? null,
            preferPdfText: preferPdfText !== false,
            minPdfTextChars: Math.max(50, Math.min(20000, Number(minPdfTextChars ?? 900) || 900)),
            azureModel,
            azurePages,
          });
          extractedText = ext.text;
          extractSource = "download_smart";
          smartSource = ext.source;
        }
      } catch (e: any) {
        console.warn("[doc_intel_run] ocr_error", {
          reqId,
          dealId,
          docId,
          ms: Date.now() - startedOne,
          error: e?.message || String(e),
        });
        return {
          stat,
          result: {
            document_id: docId,
            filename,
            ocr: "error" as const,
            doc_intel: "error" as const,
            matched_keys: [],
            updated_items: 0,
            error: e?.message || "OCR failed",
          },
        };
      }

      let docIntelStatus: "ok" | "skipped" | "error" = "skipped";
      let aiDocType: unknown = null;
      let aiTaxYear: unknown = null;
      let aiConfidence: unknown = null;

      // If we couldn't extract any text, treat as still running/empty and avoid downstream work.
      if (!String(extractedText || "").trim()) {
        console.info("[doc_intel_run] empty_text", {
          reqId,
          dealId,
          docId,
          fast: !!fast,
          azureModel,
          azurePages: azurePages ?? null,
          extractSource,
          smartSource,
          ms: Date.now() - startedOne,
        });
        return {
          stat,
          result: {
            document_id: docId,
            filename,
            ocr: "running" as const,
            doc_intel: "skipped" as const,
            matched_keys: [],
            updated_items: 0,
          },
        };
      }

      if (process.env.OPENAI_API_KEY && !fast) {
        try {
          const ai = await analyzeDocument({ dealId, fileId: docId, extractedText });
          stat.analyzed += 1;
          docIntelStatus = "ok";
          aiDocType = (ai as any)?.doc_type;
          aiTaxYear = (ai as any)?.tax_year;
          aiConfidence = (ai as any)?.confidence;
        } catch {
          // Non-fatal: still stamp deterministic metadata from OCR text.
          docIntelStatus = "error";
        }
      }

      if (docIntelStatus !== "ok") {
        await bestEffortUpsertDocIntelFromOcr({
          sb,
          dealId,
          fileId: docId,
          extractedText,
          azureModel,
          azurePages,
        });
      }

      await bestEffortStampDealDocument({
        sb,
        docId,
        filename,
        extractedText,
        aiDocType,
        aiTaxYear,
        aiConfidence,
      });
      stat.stamped += 1;

      const m = await autoMatchChecklistFromFilename({ dealId, filename, fileId: docId });
      stat.matched += m.matched.length;
      stat.updated += m.updated;

      if (m.matched.length > 0) {
        await sb.from("deal_documents").update({ checklist_key: m.matched[0] }).eq("id", docId).is("checklist_key", null);
      }

      console.info("[doc_intel_run] done_doc", {
        reqId,
        dealId,
        docId,
        ocr: "ok",
        docIntel: docIntelStatus,
        fast: !!fast,
        azureModel,
        azurePages: azurePages ?? null,
        extractSource,
        smartSource,
        textLen: (extractedText || "").length,
        stamped: stat.stamped,
        analyzed: stat.analyzed,
        matched: stat.matched,
        updated: stat.updated,
        ms: Date.now() - startedOne,
      });

      return {
        stat,
        result: {
          document_id: docId,
          filename,
          ocr: "ok" as const,
          doc_intel: docIntelStatus,
          matched_keys: m.matched,
          updated_items: m.updated,
        },
      };
    } catch (e: any) {
      console.error("[doc_intel_run] fatal_doc", {
        reqId,
        dealId,
        docId,
        ms: Date.now() - startedOne,
        error: e?.message || String(e),
      });
      return {
        stat,
        result: {
          document_id: docId,
          filename,
          ocr: "error" as const,
          doc_intel: "error" as const,
          matched_keys: [],
          updated_items: 0,
          error: e?.message || String(e),
        },
      };
    }
  }

  async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<any>) {
    const out: any[] = [];
    const queue = items.slice();
    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (queue.length) {
        const item = queue.shift() as T;
        out.push(await fn(item));
      }
    });
    await Promise.all(workers);
    return out;
  }

  const concurrency = fast ? Math.min(15, Math.max(5, Math.floor(list.length / 3))) : 1;
  const processed = await runPool(list, concurrency, processOne);

  for (const p of processed) {
    analyzed += p?.stat?.analyzed ?? 0;
    matched += p?.stat?.matched ?? 0;
    updated += p?.stat?.updated ?? 0;
    stamped += p?.stat?.stamped ?? 0;
    results.push(p.result);
  }

  // After stamping years/types, run checklist reconcile once so year-aware
  // satisfaction updates immediately.
  let reconcile: any = null;
  let reconcile_error: string | null = null;
  if (stamped > 0 || updated > 0) {
    try {
      reconcile = await reconcileDealChecklist(dealId);
    } catch (e) {
      reconcile_error = (e as any)?.message || String(e);
      console.error("[documents/intel/run] reconcile_failed (non-fatal)", e);
    }
  }

  // Totals for UI progress.
  const { count: totalDocs } = await sb
    .from("deal_documents")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId);

  const { count: trustedDocs } = await sb
    .from("doc_intel_results")
    .select("file_id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .neq("doc_type", "Unknown")
    .or("confidence.is.null,confidence.gte.60");

  const t = Number(totalDocs ?? 0) || 0;
  const trusted = Number(trustedDocs ?? 0) || 0;
  const remaining = Math.max(0, t - trusted);

  console.info("[doc_intel_run] done", {
    reqId,
    dealId,
    fast: !!fast,
    processed: list.length,
    stamped,
    analyzed,
    matched,
    updated,
    totals: { totalDocs: t, trustedDocs: trusted, remainingDocs: remaining },
    reconcile_ok: !!reconcile && !reconcile_error,
    reconcile_error,
    ms: Date.now() - startedAll,
  });

  return NextResponse.json(
    {
      ok: true,
      reqId,
      dealId,
      status: remaining === 0 ? "complete" : "partial",
      totals: { totalDocs: t, trustedDocs: trusted, remainingDocs: remaining },
      processed: list.length,
      analyzed,
      matched,
      updated,
      stamped,
      reconcile,
      reconcile_error,
      results,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * GET /api/deals/[dealId]/documents/intel/run
 *
 * Browser-friendly: returns instructions by default.
 * Add ?run=1 to actually execute.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const { dealId } = await ctx.params;
  const ensured = await ensureDealBankAccess(dealId);
  if (!ensured.ok) {
    const statusCode = ensured.error === "deal_not_found" ? 404 : ensured.error === "tenant_mismatch" ? 403 : 401;
    return NextResponse.json(
      { ok: false, error: ensured.error },
      { status: statusCode, headers: { "cache-control": "no-store" } },
    );
  }

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1";
  const limit = Math.max(1, Math.min(25, Number(url.searchParams.get("limit") || "5") || 5));
  const documentId = url.searchParams.get("documentId");

  if (!run) {
    return NextResponse.json(
      {
        ok: true,
        message: "Use POST, or GET with ?run=1 to execute.",
        examples: {
          run_latest_5: `/api/deals/${dealId}/documents/intel/run?run=1&limit=5`,
          run_one: `/api/deals/${dealId}/documents/intel/run?run=1&documentId=<document-uuid>`,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return runIntelForDeal({
    req,
    dealId,
    documentId: documentId && /^[0-9a-fA-F-]{36}$/.test(documentId) ? documentId : null,
    limit,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const { dealId } = await ctx.params;
  const ensured = await ensureDealBankAccess(dealId);
  if (!ensured.ok) {
    const statusCode = ensured.error === "deal_not_found" ? 404 : ensured.error === "tenant_mismatch" ? 403 : 401;
    return NextResponse.json(
      { ok: false, error: ensured.error },
      { status: statusCode, headers: { "cache-control": "no-store" } },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const documentId = body?.documentId ?? null;
  const limit = body?.limit ?? 5;
  const scanLimit = body?.scanLimit ?? 200;

  const fast = body?.fast ?? false;
  const preferPdfText = body?.preferPdfText ?? true;
  const minPdfTextChars = body?.minPdfTextChars ?? 900;
  const maxPages = body?.maxPages;

  return runIntelForDeal({
    req,
    dealId,
    documentId,
    limit,
    scanLimit,
    fast,
    preferPdfText,
    minPdfTextChars,
    maxPages,
  });
}
