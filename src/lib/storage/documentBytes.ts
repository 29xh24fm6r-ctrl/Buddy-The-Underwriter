/**
 * Bucket-aware document I/O — the one place that knows a deal document can
 * live in Supabase Storage *or* in GCS.
 *
 * Every `deal_documents` row carries the bucket it was written to. Uploads
 * moved to GCS (DOC_STORE=gcs) while the processing chain kept calling
 * `supabase.storage.from(row.storage_bucket).download(row.storage_path)`.
 * Supabase has no bucket named `buddy-the-underwriter-uploads`, so each of
 * those downloads failed and intake silently degraded to filename-only
 * classification: OCR skipped, quality FAILED_LOW_TEXT, gatekeeper "No OCR
 * text available", every extraction downstream reading an empty document.
 *
 * Route all document byte access through here so a future storage move is a
 * one-file change instead of a silent, per-call-site outage.
 *
 * `@/lib/storage/gcs` is imported dynamically: it is `server-only`, and a
 * static import would drag that constraint into every consumer (and every
 * unit test) even when the document lives in Supabase.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

/** The configured GCS bucket, or null when GCS storage is not configured. */
export function gcsBucketNameOrNull(): string | null {
  const bucket = String(process.env.GCS_BUCKET || "").trim();
  return bucket || null;
}

/** True when `bucket` names the GCS uploads bucket rather than a Supabase one. */
export function isGcsBucket(bucket: string | null | undefined): boolean {
  const gcs = gcsBucketNameOrNull();
  if (!gcs || !bucket) return false;
  return String(bucket).trim() === gcs;
}

/**
 * Download a document's bytes from whichever backend holds it.
 * Throws `storage_download_failed: <reason>` — the shape the processing
 * call sites already expect from the Supabase path.
 */
export async function downloadDocumentBytes(args: {
  bucket: string;
  path: string;
}): Promise<Buffer> {
  const { bucket, path } = args;
  if (!path) throw new Error("storage_download_failed: missing storage_path");

  if (isGcsBucket(bucket)) {
    try {
      const { downloadGcsObject } = await import("@/lib/storage/gcs");
      return await downloadGcsObject({ bucket, key: path });
    } catch (e: any) {
      throw new Error(`storage_download_failed: ${e?.message ?? String(e)}`);
    }
  }

  const sb = supabaseAdmin();
  const dl = await sb.storage.from(bucket).download(path);
  if (dl.error || !dl.data) {
    throw new Error(`storage_download_failed: ${dl.error?.message ?? "unknown"}`);
  }
  return Buffer.from(await dl.data.arrayBuffer());
}

/** Write bytes to whichever backend the document set belongs to. */
export async function uploadDocumentBytes(args: {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  contentType: string;
  upsert?: boolean;
}): Promise<void> {
  const { bucket, path, bytes, contentType, upsert = true } = args;

  if (isGcsBucket(bucket)) {
    const { uploadGcsObject } = await import("@/lib/storage/gcs");
    await uploadGcsObject({ bucket, key: path, bytes, contentType, overwrite: upsert });
    return;
  }

  const { error } = await supabaseAdmin()
    .storage.from(bucket)
    .upload(path, bytes, { contentType, upsert });
  if (error) throw error;
}

/** Remove an object (segmentation rollback, dedupe cleanup). Best-effort. */
export async function deleteDocumentObject(args: {
  bucket: string;
  path: string;
}): Promise<void> {
  const { bucket, path } = args;

  if (isGcsBucket(bucket)) {
    const { deleteGcsObject } = await import("@/lib/storage/gcs");
    await deleteGcsObject({ bucket, key: path });
    return;
  }

  await supabaseAdmin().storage.from(bucket).remove([path]);
}

/** A time-limited read URL for viewing/downloading a document in the UI. */
export async function createDocumentDownloadUrl(args: {
  bucket: string;
  path: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const { bucket, path, expiresInSeconds = 60 * 10 } = args;

  if (isGcsBucket(bucket)) {
    const { signGcsReadUrl } = await import("@/lib/storage/gcs");
    return signGcsReadUrl({ bucket, key: path, expiresSeconds: expiresInSeconds });
  }

  const { data, error } = await supabaseAdmin()
    .storage.from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw error ?? new Error("failed_to_sign_download_url");
  }
  return data.signedUrl;
}
