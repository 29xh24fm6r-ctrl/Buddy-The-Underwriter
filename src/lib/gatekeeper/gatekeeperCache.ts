/**
 * OpenAI Gatekeeper — Classification Cache
 *
 * Tenant-isolated cache keyed by (bank_id, sha256, prompt_hash).
 * The prompt_hash component ensures automatic cache invalidation when
 * the prompt template or schema changes.
 *
 * Follows the same pattern as virus_scan_cache and doc_extraction_cache.
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { GatekeeperClassification } from "./types";

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * Look up a cached gatekeeper classification result.
 * Returns the raw classification (without route — caller applies routing rules)
 * plus metadata.
 */
export async function readGatekeeperCache(
  bankId: string,
  sha256: string,
  promptHash: string,
): Promise<{
  classification: GatekeeperClassification;
  model: string;
  prompt_version: string;
  prompt_tokens?: number;
  completion_tokens?: number;
} | null> {
  const sb = supabaseAdmin();

  const { data, error } = await (sb as any)
    .from("doc_gatekeeper_cache")
    .select("result_json, model, prompt_version, prompt_tokens, completion_tokens")
    .eq("bank_id", bankId)
    .eq("sha256", sha256)
    .eq("prompt_hash", promptHash)
    .maybeSingle();

  if (error || !data) return null;

  return {
    classification: data.result_json as GatekeeperClassification,
    model: data.model,
    prompt_version: data.prompt_version,
    prompt_tokens: data.prompt_tokens ?? undefined,
    completion_tokens: data.completion_tokens ?? undefined,
  };
}

// ─── Write ──────────────────────────────────────────────────────────────────

/**
 * Write a gatekeeper classification result to the cache.
 * Upserts on (bank_id, sha256, prompt_hash) to handle re-runs.
 * Never throws — cache write failures are non-fatal.
 */
export async function writeGatekeeperCache(args: {
  bankId: string;
  sha256: string;
  promptHash: string;
  resultJson: GatekeeperClassification;
  model: string;
  promptVersion: string;
  promptTokens?: number;
  completionTokens?: number;
}): Promise<void> {
  const sb = supabaseAdmin();

  try {
    await (sb as any)
      .from("doc_gatekeeper_cache")
      .upsert(
        {
          bank_id: args.bankId,
          sha256: args.sha256,
          prompt_hash: args.promptHash,
          result_json: args.resultJson,
          model: args.model,
          prompt_version: args.promptVersion,
          prompt_tokens: args.promptTokens ?? null,
          completion_tokens: args.completionTokens ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "bank_id,sha256,prompt_hash" },
      );
  } catch (e) {
    console.warn("[gatekeeperCache] write failed (non-fatal)", String((e as any)?.message ?? e));
  }
}
