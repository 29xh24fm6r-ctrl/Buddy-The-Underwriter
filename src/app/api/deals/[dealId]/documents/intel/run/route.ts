import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { analyzeDocument } from "@/lib/docIntel/engine";
import { autoMatchChecklistFromFilename } from "@/lib/deals/autoMatchChecklistFromFilename";

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

/**
 * POST /api/deals/[dealId]/documents/intel/run
 *
 * Best-effort: For one document or a small batch, download from storage, run Azure DI OCR,
 * run doc-intel (OpenAI JSON), persist into doc_intel_results, then auto-match checklist.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const ensured = await ensureDealBankAccess(dealId);
  if (!ensured.ok) {
    const statusCode = ensured.error === "deal_not_found" ? 404 : ensured.error === "tenant_mismatch" ? 403 : 401;
    return NextResponse.json({ ok: false, error: ensured.error }, { status: statusCode });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const documentId = body?.documentId ?? null;
  const limit = body?.limit ?? 5;

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
    return NextResponse.json({ ok: false, error: "Failed to load deal documents", details: docsErr }, { status: 500 });
  }

  const list = docs ?? [];
  if (list.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, analyzed: 0, matched: 0, updated: 0, results: [] });
  }

  let analyzed = 0;
  let matched = 0;
  let updated = 0;

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
        .select("id")
        .eq("deal_id", dealId)
        .eq("file_id", docId)
        .maybeSingle();

      if (!existingIntel.error && existingIntel.data?.id) {
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

      // Run doc-intel on extracted text
      await analyzeDocument({
        dealId,
        fileId: docId,
        extractedText,
      });
      analyzed += 1;

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
        doc_intel: "ok",
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

  return NextResponse.json({
    ok: true,
    dealId,
    processed: list.length,
    analyzed,
    matched,
    updated,
    results,
  });
}
