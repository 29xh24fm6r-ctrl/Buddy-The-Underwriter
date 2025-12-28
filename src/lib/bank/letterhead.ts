import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Returns the ACTIVE bank letterhead upload (if any)
 * Uses existing uploads table + metadata_json convention
 * 
 * Convention: uploads.metadata_json = {
 *   "kind": "bank_letterhead",
 *   "bank_id": "...",
 *   "active": true
 * }
 */
export async function getActiveLetterhead(bankId: string) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("uploads")
    .select("id, storage_bucket, storage_path, metadata_json, deal_id")
    .eq("metadata_json->>kind", "bank_letterhead")
    .eq("metadata_json->>bank_id", bankId)
    .eq("metadata_json->>active", "true")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    id: data.id,
    bucket: data.storage_bucket,
    path: data.storage_path,
    metadata: data.metadata_json,
  };
}

/**
 * Downloads letterhead image from Supabase storage to a local buffer
 * Returns Buffer for use in PDFKit
 */
export async function downloadLetterheadBuffer(
  bucket: string,
  path: string
): Promise<Buffer | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb.storage.from(bucket).download(path);

  if (error || !data) {
    console.error("Failed to download letterhead:", error);
    return null;
  }

  return Buffer.from(await data.arrayBuffer());
}
