/**
 * Buddy DB row naming compatibility.
 *
 * Reality: Supabase returns snake_case columns.
 * UI/components often prefer camelCase.
 *
 * This helper provides:
 *  - a typed "Snake<T>" version of a camel type
 *  - a narrow runtime mapper for the handful of fields we actually use (no perf drama)
 */

export type Snake<T> = {
  [K in keyof T as K extends string
    ? K extends `${infer A}${infer B}`
      ? `${Lowercase<A>}${SnakeCaseTail<B>}`
      : K
    : K]: T[K];
};

type SnakeCaseTail<S extends string> =
  S extends `${infer C}${infer R}`
    ? C extends Lowercase<C>
      ? `${C}${SnakeCaseTail<R>}`
      : `_${Lowercase<C>}${SnakeCaseTail<R>}`
    : "";

/**
 * Minimal mapping for known "pageStart/pageEnd/chunkIndex" style fields.
 * Extend this only where needed.
 */
export function mapEvidenceChunkRow(row: any) {
  if (!row || typeof row !== "object") return row;
  return {
    ...row,
    pageStart: (row.pageStart ?? row.page_start) ?? row.page_start,
    pageEnd: (row.pageEnd ?? row.page_end) ?? row.page_end,
    chunkIndex: row.chunkIndex ?? row.chunk_index,
    chunkId: (row.chunkId ?? row.chunk_id) ?? row.chunk_id,
    dealId: row.dealId ?? row.deal_id,
    uploadId: row.uploadId ?? row.upload_id,
    documentId: (row.documentId ?? row.document_id) ?? row.document_id,
    actorUserId: row.actorUserId ?? row.actor_user_id,
    createdAt: row.createdAt ?? row.created_at,
    originalFilename: row.originalFilename ?? row.original_filename,
    storageBucket: row.storageBucket ?? row.storage_bucket,
    storagePath: row.storagePath ?? row.storage_path,
  };
}
