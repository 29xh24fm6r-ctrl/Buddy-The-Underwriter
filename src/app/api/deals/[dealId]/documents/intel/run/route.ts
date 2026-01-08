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

const BodySchema = z
  .object({
    documentId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .optional();

async function extractTextWithAzureDI(bytes: Buffer): Promise<string> {
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
  const poller = await client.beginAnalyzeDocument("prebuilt-layout", bytes);
  const analyzeResult = await poller.pollUntilDone();

  const content = typeof (analyzeResult as any)?.content === "string" ? (analyzeResult as any).content : "";
  return content;
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
  const { sb, docId, filename, extractedText, aiDocType, aiTaxYear, aiConfidence } =
    args;

  const meta = inferDocumentMetadata({
    originalFilename: filename || null,
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
}) {
  const { dealId, documentId, limit } = args;
  const sb = supabaseAdmin();

  // Load docs (one or small batch)
  const docsQ = sb
    .from("deal_documents")
    .select("id, storage_path, original_filename, mime_type")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(documentId ? 1 : limit);

  const docsRes = documentId ? docsQ.eq("id", documentId) : docsQ;
  const { data: docs, error: docsErr } = await docsRes;

  if (docsErr) {
    return NextResponse.json(
      { ok: false, error: "Failed to load deal documents", details: docsErr },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  const list = docs ?? [];
  if (list.length === 0) {
    return NextResponse.json(
      { ok: true, processed: 0, analyzed: 0, matched: 0, updated: 0, results: [] },
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
    ocr: "skipped" | "ok" | "error";
    doc_intel: "skipped" | "ok" | "error";
    matched_keys: string[];
    updated_items: number;
    error?: string;
  }> = [];

  for (const doc of list) {
    const docId = String(doc.id);
    const filename = String(doc.original_filename || "");

    try {
      // If doc_intel already exists, skip heavy work.
      const existingIntel = await sb
        .from("doc_intel_results")
        .select("id, doc_type, tax_year, confidence")
        .eq("deal_id", dealId)
        .eq("file_id", docId)
        .maybeSingle();

      if (!existingIntel.error && existingIntel.data?.id) {
        await bestEffortStampDealDocument({
          sb,
          docId,
          filename,
          aiDocType: (existingIntel.data as any)?.doc_type,
          aiTaxYear: (existingIntel.data as any)?.tax_year,
          aiConfidence: (existingIntel.data as any)?.confidence,
        });
        stamped += 1;
        const m = await autoMatchChecklistFromFilename({ dealId, filename, fileId: docId });
        matched += m.matched.length;
        updated += m.updated;
        results.push({
          document_id: docId,
          filename,
          ocr: "skipped",
          doc_intel: "skipped",
          matched_keys: m.matched,
          updated_items: m.updated,
        });
        continue;
      }

      // Download bytes from storage
      const storagePath = String(doc.storage_path || "");
      if (!storagePath) {
        results.push({
          document_id: docId,
          filename,
          ocr: "error",
          doc_intel: "error",
          matched_keys: [],
          updated_items: 0,
          error: "Missing storage_path",
        });
        continue;
      }

      const dl = await sb.storage.from("deal-files").download(storagePath);
      if (dl.error || !dl.data) {
        results.push({
          document_id: docId,
          filename,
          ocr: "error",
          doc_intel: "error",
          matched_keys: [],
          updated_items: 0,
          error: `Storage download failed: ${dl.error?.message || "unknown"}`,
        });
        continue;
      }

      const bytes = Buffer.from(await dl.data.arrayBuffer());

      let extractedText = "";
      try {
        extractedText = await extractTextWithAzureDI(bytes);
      } catch (e: any) {
        results.push({
          document_id: docId,
          filename,
          ocr: "error",
          doc_intel: "error",
          matched_keys: [],
          updated_items: 0,
          error: e?.message || "OCR failed",
        });
        continue;
      }

      let docIntelStatus: "ok" | "skipped" | "error" = "skipped";
      let aiDocType: unknown = null;
      let aiTaxYear: unknown = null;
      let aiConfidence: unknown = null;

      if (process.env.OPENAI_API_KEY) {
        try {
          const ai = await analyzeDocument({
            dealId,
            fileId: docId,
            extractedText,
          });
          analyzed += 1;
          docIntelStatus = "ok";
          aiDocType = (ai as any)?.doc_type;
          aiTaxYear = (ai as any)?.tax_year;
          aiConfidence = (ai as any)?.confidence;
        } catch (_e: any) {
          // Non-fatal: still stamp deterministic metadata from OCR text.
          docIntelStatus = "error";
        }
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
      stamped += 1;

      // Now match checklist using doc-intel preference
      const m = await autoMatchChecklistFromFilename({ dealId, filename, fileId: docId });
      matched += m.matched.length;
      updated += m.updated;

      // Stamp deal_documents.checklist_key (first match) if unset
      if (m.matched.length > 0) {
        await sb
          .from("deal_documents")
          .update({ checklist_key: m.matched[0] })
          .eq("id", docId)
          .is("checklist_key", null);
      }

      results.push({
        document_id: docId,
        filename,
        ocr: "ok",
        doc_intel: docIntelStatus,
        matched_keys: m.matched,
        updated_items: m.updated,
      });
    } catch (e: any) {
      results.push({
        document_id: docId,
        filename,
        ocr: "error",
        doc_intel: "error",
        matched_keys: [],
        updated_items: 0,
        error: e?.message || String(e),
      });
    }
  }

  // After stamping years/types, run checklist reconcile once so year-aware
  // satisfaction updates immediately.
  let reconcile: any = null;
  let reconcile_error: string | null = null;
  try {
    reconcile = await reconcileDealChecklist(dealId);
  } catch (e) {
    reconcile_error = (e as any)?.message || String(e);
    console.error("[documents/intel/run] reconcile_failed (non-fatal)", e);
  }

  return NextResponse.json(
    {
      ok: true,
      dealId,
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

  return runIntelForDeal({ req, dealId, documentId, limit });
}
