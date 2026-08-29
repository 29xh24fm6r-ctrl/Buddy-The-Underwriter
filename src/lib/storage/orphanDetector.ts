import type { SupabaseClient } from "@supabase/supabase-js";

import { isGcsBucket } from "@/lib/storage/documentBytes";

type StorageObject = {
  name: string;
  id?: string;
  updated_at?: string;
  created_at?: string;
  last_accessed_at?: string;
  metadata?: { size?: number; mimetype?: string; etag?: string };
};

type ScanInput = {
  sb: SupabaseClient;
  bucket: string;
  prefix: string; // e.g. "deals/"
  runId: string;
  maxObjects?: number; // safety cap
};

function isFolderLike(obj: StorageObject) {
  return (
    obj.name.endsWith("/") ||
    (obj.id == null && obj.metadata == null)
  );
}

type CachedObject = {
  path: string;
  sizeBytes: number | null;
  mimeType: string | null;
  lastModified: string | null;
  etag: string | null;
};

/**
 * List a GCS prefix. GCS has no folders — one flat, paginated listing covers
 * the whole prefix, so this needs none of the breadth-first walking the
 * Supabase API forces.
 *
 * Request one object beyond the configured cap. Without that sentinel,
 * getFiles({ maxResults }) can silently truncate a listing while the caller
 * records the scan as complete.
 */
async function listGcsPrefix(
  bucket: string,
  prefix: string,
  maxObjects: number,
): Promise<{ objects: CachedObject[]; capped: boolean }> {
  const { getGcsClient } = await import("@/lib/storage/gcs");
  const storage = await getGcsClient();
  const [files] = await storage
    .bucket(bucket)
    .getFiles({ prefix, maxResults: maxObjects + 1 });

  const capped = files.length > maxObjects;
  const objects = files.slice(0, maxObjects).map((file: any) => ({
    path: String(file.name),
    sizeBytes:
      file.metadata?.size != null ? Number(file.metadata.size) : null,
    mimeType: file.metadata?.contentType ?? null,
    lastModified:
      file.metadata?.updated ?? file.metadata?.timeCreated ?? null,
    etag: file.metadata?.etag ?? null,
  }));

  return { objects, capped };
}

// Supabase storage.list() is paginated by "limit" and "offset".
// We do a bounded breadth-first traversal from prefix and exhaust every page.
export async function scanBucketPrefixToCache(input: ScanInput) {
  const { sb, bucket, prefix, runId, maxObjects = 25000 } = input;

  if (isGcsBucket(bucket)) {
    const { objects, capped } = await listGcsPrefix(
      bucket,
      prefix.replace(/^\//, ""),
      maxObjects,
    );

    let stored = 0;
    for (const obj of objects) {
      const ins = await sb.from("storage_objects_cache").insert({
        scan_run_id: runId,
        bucket,
        path: obj.path,
        size_bytes: obj.sizeBytes,
        mime_type: obj.mimeType,
        last_modified: obj.lastModified,
        etag: obj.etag,
      });

      if (ins.error) {
        throw new Error(
          `insert storage_objects_cache failed: ${ins.error.message}`,
        );
      }
      stored++;
    }

    return { capped, seen: stored };
  }

  const queue: string[] = [
    prefix.replace(/^\//, "").replace(/\/?$/, "/"),
  ];
  let seen = 0;

  while (queue.length) {
    const folder = queue.shift()!;

    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await sb.storage.from(bucket).list(folder, {
        limit: 1000,
        offset,
        sortBy: { column: "name", order: "asc" },
      });

      if (error) {
        throw new Error(
          `storage.list failed for ${bucket}/${folder}: ${error.message}`,
        );
      }

      const items: StorageObject[] = data || [];
      for (const obj of items) {
        const fullPath = `${folder}${obj.name}`.replace(/^\//, "");
        if (isFolderLike(obj)) {
          queue.push(fullPath);
          continue;
        }

        if (seen >= maxObjects) return { capped: true, seen };

        const sizeBytes = obj.metadata?.size ?? null;
        const mimeType = obj.metadata?.mimetype ?? null;
        const etag = obj.metadata?.etag ?? null;
        const lastModified = obj.updated_at ?? obj.created_at ?? null;

        const ins = await sb.from("storage_objects_cache").insert({
          scan_run_id: runId,
          bucket,
          path: fullPath,
          size_bytes: sizeBytes,
          mime_type: mimeType,
          last_modified: lastModified,
          etag,
        });

        if (ins.error) {
          throw new Error(
            `insert storage_objects_cache failed: ${ins.error.message}`,
          );
        }
        seen++;
      }

      if (items.length < 1000) break;
    }
  }

  return { capped: false, seen };
}
