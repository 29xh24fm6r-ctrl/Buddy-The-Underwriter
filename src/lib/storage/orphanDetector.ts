import type { SupabaseClient } from "@supabase/supabase-js";

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

function isFolderLike(name: string) {
  return name.endsWith("/");
}

// Supabase storage.list() is paginated by "limit" and "offset" (offset can be slow for huge buckets).
// We do a bounded breadth-first traversal from prefix.
export async function scanBucketPrefixToCache(input: ScanInput) {
  const { sb, bucket, prefix, runId, maxObjects = 25000 } = input;

  const queue: string[] = [prefix.replace(/^\//, "").replace(/\/?$/, "/")];
  let seen = 0;

  while (queue.length) {
    const folder = queue.shift()!;
    // list folder contents
    const { data, error } = await sb.storage.from(bucket).list(folder, {
      limit: 1000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) throw new Error(`storage.list failed for ${bucket}/${folder}: ${error.message}`);

    const items: StorageObject[] = data || [];
    for (const obj of items) {
      if (seen >= maxObjects) return { capped: true, seen };

      const fullPath = `${folder}${obj.name}`.replace(/^\//, "");
      if (isFolderLike(obj.name)) {
        queue.push(fullPath);
        continue;
      }

      const sizeBytes = obj?.metadata?.size ?? null;
      const mimeType = obj?.metadata?.mimetype ?? null;
      const etag = obj?.metadata?.etag ?? null;
      const lastModified = obj?.updated_at ?? obj?.created_at ?? null;

      const ins = await sb.from("storage_objects_cache").insert({
        scan_run_id: runId,
        bucket,
        path: fullPath,
        size_bytes: sizeBytes,
        mime_type: mimeType,
        last_modified: lastModified,
        etag,
      });

      if (ins.error) throw new Error(`insert storage_objects_cache failed: ${ins.error.message}`);
      seen++;
    }
  }

  return { capped: false, seen };
}

export async function computeOrphansFromCache(sb: SupabaseClient, runId: string) {
  // Strategy:
  // 1) storage_only: cache paths that have no matching deal_documents(storage_bucket, storage_path)
  // 2) db_only: deal_documents that have no matching cached path in scan
  //
  // We also attempt to parse deal_id from path: deals/<dealId>/...

  // storage_only
  const storageOnlySql = `
    insert into public.orphan_findings (scan_run_id, kind, deal_id, bucket, path, document_id, details)
    select
      c.scan_run_id,
      'storage_only',
      nullif(split_part(c.path, '/', 2), '')::uuid as deal_id,
      c.bucket,
      c.path,
      null,
      jsonb_build_object('reason','Object exists in Storage but no deal_documents row','size_bytes',c.size_bytes,'mime_type',c.mime_type)
    from public.storage_objects_cache c
    left join public.deal_documents d
      on d.storage_bucket = c.bucket
     and d.storage_path = c.path
    where c.scan_run_id = $1
      and d.id is null;
  `;

  // db_only
  const dbOnlySql = `
    insert into public.orphan_findings (scan_run_id, kind, deal_id, bucket, path, document_id, details)
    select
      $1::uuid as scan_run_id,
      'db_only',
      d.deal_id,
      d.storage_bucket,
      d.storage_path,
      d.id,
      jsonb_build_object('reason','deal_documents row exists but object not found in scanned Storage prefix')
    from public.deal_documents d
    left join public.storage_objects_cache c
      on c.scan_run_id = $1
     and c.bucket = d.storage_bucket
     and c.path = d.storage_path
    where c.id is null
      and d.storage_bucket is not null
      and d.storage_path is not null;
  `;

  const a = await sb.rpc("exec_sql", { sql: storageOnlySql, params: [runId] } as any);
  if (a.error) {
    // If you do NOT have an exec_sql helper RPC, we'll run these via API using service client and .from queries instead.
    // We'll fall back by throwing, and you can tell me if exec_sql is unavailable.
    throw new Error(`computeOrphans requires exec_sql rpc or alternate implementation: ${a.error.message}`);
  }

  const b = await sb.rpc("exec_sql", { sql: dbOnlySql, params: [runId] } as any);
  if (b.error) throw new Error(`computeOrphans requires exec_sql rpc: ${b.error.message}`);
}
