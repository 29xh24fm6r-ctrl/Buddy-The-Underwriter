/**
 * Spec D5 — Pure reclassify loop.
 *
 * Extracted from route.ts so the accumulation logic (reclassified / failed
 * counts, result rows, error rows) can be unit tested without mocking the
 * full Next.js request cycle, supabase, or Gemini. The route simply wires
 * this function up to the real gatekeeper.
 *
 * No "server-only" import — tests run under node --import tsx --test.
 */

import type { GatekeeperResult } from "@/lib/gatekeeper/types";

export type ClassifyLoopDoc = {
  id: string;
  deal_id: string;
  bank_id: string;
  sha256: string | null;
  ocr_text: string | null;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  original_filename: string | null;
};

export type ClassifyLoopResultRow = {
  documentId: string;
  filename: string | null;
  doc_type: string;
  confidence: number;
  cache_hit: boolean;
  business_name: string | null;
  borrower_name: string | null;
};

export type ClassifyLoopErrorRow = {
  documentId: string;
  filename: string | null;
  error: string;
};

export type ClassifyLoopSummary = {
  total: number;
  reclassified: number;
  failed: number;
  results: ClassifyLoopResultRow[];
  errors: ClassifyLoopErrorRow[];
};

export type ClassifyFn = (doc: ClassifyLoopDoc) => Promise<GatekeeperResult>;

/**
 * Iterate serially over every doc; one Gemini call per doc. Errors on
 * individual docs are accumulated into `errors` and do not abort the loop —
 * a partial success (8/9 reclassified) is a legitimate outcome.
 */
export async function classifyAllDocs(
  docs: ClassifyLoopDoc[],
  classify: ClassifyFn,
): Promise<ClassifyLoopSummary> {
  const results: ClassifyLoopResultRow[] = [];
  const errors: ClassifyLoopErrorRow[] = [];

  for (const doc of docs) {
    try {
      const result = await classify(doc);
      results.push({
        documentId: doc.id,
        filename: doc.original_filename,
        doc_type: result.doc_type,
        confidence: result.confidence,
        cache_hit: result.cache_hit,
        business_name: result.detected_signals.business_name ?? null,
        borrower_name: result.detected_signals.borrower_name ?? null,
      });
    } catch (e) {
      errors.push({
        documentId: doc.id,
        filename: doc.original_filename,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }

  return {
    total: docs.length,
    reclassified: results.length,
    failed: errors.length,
    results,
    errors,
  };
}
