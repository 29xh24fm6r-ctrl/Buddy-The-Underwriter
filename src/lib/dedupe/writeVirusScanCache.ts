import "server-only";

import type { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Write a virus scan result to the cross-deal cache.
 *
 * Called after a virus scan completes (whether clean, infected, or failed).
 * Idempotent: UNIQUE(bank_id, content_sha256) with ON CONFLICT DO NOTHING
 * ensures only the first result is cached.
 */
export async function writeVirusScanCache(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  bankId: string;
  contentSha256: string;
  scanStatus: "clean" | "infected" | "scan_failed";
  scanEngine: string;
  virusSignature?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await (args.sb as any)
      .from("virus_scan_cache")
      .upsert(
        {
          bank_id: args.bankId,
          content_sha256: args.contentSha256,
          scan_status: args.scanStatus,
          scan_engine: args.scanEngine,
          virus_signature: args.virusSignature ?? null,
          scanned_at: new Date().toISOString(),
        },
        { onConflict: "bank_id,content_sha256", ignoreDuplicates: true },
      );

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
