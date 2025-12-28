/**
 * Policy snapshot helpers - snapshot-on-use pattern
 * Captures policy state when decision is made (time-travel debugging)
 */
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Get current policy snapshot (from latest policy chunks)
 */
export async function getPolicySnapshot(bankId: string) {
  const sb = supabaseAdmin();

  // Get all active policy chunks for bank
  const { data: chunks } = await sb
    .from("policy_chunks")
    .select("chunk_key, content, metadata")
    .eq("bank_id", bankId)
    .eq("active", true);

  if (!chunks) return null;

  return {
    timestamp: new Date().toISOString(),
    chunks: chunks.map((c) => ({
      chunk_key: c.chunk_key,
      content: c.content,
      metadata: c.metadata,
    })),
  };
}

/**
 * Persist policy snapshot for a specific decision (optional versioning)
 */
export async function persistPolicySnapshot(
  bankId: string,
  chunkKey: string,
  content: string,
  metadata: any = {}
) {
  const sb = supabaseAdmin();

  // Get next version number
  const { data: existing } = await sb
    .from("policy_chunk_versions")
    .select("version")
    .eq("chunk_key", chunkKey)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (existing?.version || 0) + 1;

  const { data, error } = await sb
    .from("policy_chunk_versions")
    .insert({
      bank_id: bankId,
      chunk_key: chunkKey,
      version: nextVersion,
      content,
      metadata_json: metadata,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to persist policy snapshot", error);
    return null;
  }

  return data;
}
