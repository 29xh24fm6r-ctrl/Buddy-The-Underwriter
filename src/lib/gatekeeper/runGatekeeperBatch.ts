/**
 * OpenAI Gatekeeper — Batch Orchestrator
 *
 * Entry point called from orchestrateIntake().
 * Runs gatekeeper classification for all unclassified documents in a deal.
 *
 * Feature-flagged: callers should check isOpenAiGatekeeperEnabled()
 * BEFORE calling this function (so the step can report "skipped_or_disabled").
 *
 * Concurrency: up to 3 docs in parallel, max 20 per batch.
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { runGatekeeperForDocument } from "./runGatekeeper";
import type { GatekeeperDocInput, GatekeeperBatchResult } from "./types";

const MAX_CONCURRENCY = 3;
const MAX_BATCH_SIZE = 20;

export async function runGatekeeperBatch(args: {
  dealId: string;
  bankId: string;
  forceReclassify?: boolean;
}): Promise<GatekeeperBatchResult> {
  const sb = supabaseAdmin();

  // ── Fetch documents needing gatekeeper classification ──────────────────
  let query = (sb as any)
    .from("deal_documents")
    .select("id, deal_id, bank_id, sha256, storage_path, storage_bucket, mime_type")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH_SIZE);

  if (!args.forceReclassify) {
    query = query.is("gatekeeper_classified_at", null);
  }

  const { data: docs, error } = await query;

  if (error || !docs || docs.length === 0) {
    return {
      total: 0,
      classified: 0,
      cached: 0,
      needs_review: 0,
      errors: 0,
      results: [],
    };
  }

  // ── Bulk-fetch OCR text for all docs in one query ─────────────────────
  const docIds = docs.map((d: any) => String(d.id));
  const { data: ocrRows } = await (sb as any)
    .from("document_ocr_results")
    .select("attachment_id, extracted_text")
    .in("attachment_id", docIds);

  const ocrByDoc = new Map<string, string>();
  for (const row of ocrRows ?? []) {
    const id = String((row as any).attachment_id ?? "");
    const text = String((row as any).extracted_text ?? "");
    if (id && text) ocrByDoc.set(id, text);
  }

  // ── Build inputs ──────────────────────────────────────────────────────
  const inputs: GatekeeperDocInput[] = docs.map((doc: any) => ({
    documentId: String(doc.id),
    dealId: String(doc.deal_id),
    bankId: String(doc.bank_id),
    sha256: doc.sha256 ?? null,
    ocrText: ocrByDoc.get(String(doc.id)) ?? null,
    storageBucket: doc.storage_bucket || "deal-documents",
    storagePath: doc.storage_path || "",
    mimeType: doc.mime_type || "application/pdf",
    forceReclassify: args.forceReclassify,
  }));

  // ── Process with concurrency limit ────────────────────────────────────
  const results: GatekeeperBatchResult["results"] = [];
  let classified = 0;
  let cached = 0;
  let needsReview = 0;
  let errors = 0;

  for (let i = 0; i < inputs.length; i += MAX_CONCURRENCY) {
    const chunk = inputs.slice(i, i + MAX_CONCURRENCY);
    const chunkResults = await Promise.allSettled(
      chunk.map((input) => runGatekeeperForDocument(input)),
    );

    for (let j = 0; j < chunkResults.length; j++) {
      const settled = chunkResults[j];
      const input = chunk[j];

      if (settled.status === "fulfilled") {
        const result = settled.value;
        results.push({ documentId: input.documentId, result });
        classified++;
        if (result.cache_hit) cached++;
        if (result.needs_review) needsReview++;
      } else {
        // Should rarely happen since runGatekeeperForDocument is fail-closed
        results.push({
          documentId: input.documentId,
          result: null,
          error: settled.reason?.message ?? "unknown",
        });
        errors++;
      }
    }
  }

  return {
    total: inputs.length,
    classified,
    cached,
    needs_review: needsReview,
    errors,
    results,
  };
}
