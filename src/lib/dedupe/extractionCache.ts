import "server-only";

import type { supabaseAdmin } from "@/lib/supabase/admin";

/** Bump when OCR prompts or parsers change to invalidate stale cache. */
export const GEMINI_OCR_VERSION = "v2026-02-09";
export const DOCAI_VERSION = "v2026-02-09";
export const GEMINI_EXTRACT_VERSION = "v2026-02-09";

export type CacheEngine = "GEMINI_OCR" | "DOCAI" | "GEMINI_EXTRACT";

export type ExtractionCachePayload = {
  text?: string;
  fields?: Record<string, any>;
  tables?: any[];
  evidence?: any[];
  model?: string;
  pageCount?: number;
  [key: string]: any;
};

/**
 * Look up cached extraction results for identical file content.
 * Returns the cached payload or null if no cache hit.
 */
export async function readExtractionCache(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  bankId: string;
  contentSha256: string;
  engine: CacheEngine;
  engineVersion: string;
}): Promise<ExtractionCachePayload | null> {
  try {
    const { data } = await (args.sb as any)
      .from("doc_extraction_cache")
      .select("payload")
      .eq("bank_id", args.bankId)
      .eq("content_sha256", args.contentSha256)
      .eq("engine", args.engine)
      .eq("engine_version", args.engineVersion)
      .maybeSingle();

    return data?.payload ?? null;
  } catch (err: any) {
    console.warn("[extractionCache] read failed (non-fatal)", err?.message);
    return null;
  }
}

/**
 * Write extraction results to the cache for future reuse.
 * Idempotent via UNIQUE constraint + ON CONFLICT DO NOTHING.
 */
export async function writeExtractionCache(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  bankId: string;
  contentSha256: string;
  engine: CacheEngine;
  engineVersion: string;
  payload: ExtractionCachePayload;
}): Promise<void> {
  try {
    await (args.sb as any)
      .from("doc_extraction_cache")
      .upsert(
        {
          bank_id: args.bankId,
          content_sha256: args.contentSha256,
          engine: args.engine,
          engine_version: args.engineVersion,
          payload: args.payload,
        },
        {
          onConflict: "bank_id,content_sha256,engine,engine_version",
          ignoreDuplicates: true,
        },
      );
  } catch (err: any) {
    console.warn("[extractionCache] write failed (non-fatal)", err?.message);
  }
}
