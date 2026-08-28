import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type NewlyUploadedObject = {
  bucket: string;
  path: string;
};

type PersistRowWithStorageRollbackArgs = {
  table: string;
  filters: Record<string, string>;
  values: Record<string, unknown>;
  expected: Record<string, unknown>;
  uploaded: NewlyUploadedObject[];
  label: string;
};

/**
 * Persist the authoritative database reference for newly uploaded storage
 * objects. PostgREST updates do not return rows unless select() is chained, so
 * an error-free update alone cannot prove that the lease/filter matched.
 *
 * If the database reference is not proven, remove only the objects created by
 * this attempt. Previously referenced/resumable artifacts are never deleted.
 */
export async function persistRowWithStorageRollback(
  sb: SupabaseClient,
  args: PersistRowWithStorageRollbackArgs,
): Promise<Record<string, unknown>> {
  const proofColumns = ["id", ...Object.keys(args.expected)].join(",");
  let query = sb.from(args.table).update(args.values);
  for (const [column, value] of Object.entries(args.filters)) {
    query = query.eq(column, value);
  }

  const { data, error } = await query.select(proofColumns).maybeSingle();
  const row = data as Record<string, unknown> | null;
  const mismatch = row
    ? Object.entries(args.expected).find(([column, expected]) => !Object.is(row[column], expected))
    : null;

  if (!error && row && !mismatch) return row;

  const cleanupFailures = await removeNewlyUploadedObjects(sb, args.uploaded);
  const reason = error?.message
    ?? (mismatch
      ? `returned_${mismatch[0]}_mismatch`
      : "row_not_returned");
  throw new Error(
    `${args.label} manifest write failed: ${reason}` +
      (cleanupFailures.length > 0
        ? `; storage rollback failed: ${cleanupFailures.join(" | ")}`
        : ""),
  );
}

async function removeNewlyUploadedObjects(
  sb: SupabaseClient,
  objects: NewlyUploadedObject[],
): Promise<string[]> {
  const byBucket = new Map<string, Set<string>>();
  for (const object of objects) {
    if (!object.bucket || !object.path) continue;
    const paths = byBucket.get(object.bucket) ?? new Set<string>();
    paths.add(object.path);
    byBucket.set(object.bucket, paths);
  }

  const failures: string[] = [];
  for (const [bucket, pathSet] of byBucket) {
    const paths = [...pathSet];
    const { error } = await sb.storage.from(bucket).remove(paths);
    if (error) failures.push(`${bucket}: ${error.message}`);
  }
  return failures;
}
