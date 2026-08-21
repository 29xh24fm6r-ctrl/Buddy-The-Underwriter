import type { supabaseAdmin } from "@/lib/supabase/admin";

export async function findExistingDocBySha(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  dealId: string;
  sha256: string;
}): Promise<{ id: string; storage_bucket: string | null; storage_path: string | null } | null> {
  const { data, error } = await args.sb
    .from("deal_documents")
    .select("id, storage_bucket, storage_path")
    .eq("deal_id", args.dealId)
    .eq("sha256", args.sha256)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: String(data.id),
    storage_bucket: data.storage_bucket ?? null,
    storage_path: data.storage_path ?? null,
  };
}

/**
 * Dedupe fallback for rows the hash cannot see.
 *
 * `findExistingDocBySha` compares hashes, and every row written before the
 * client started hashing has `sha256` NULL — so re-uploading a file that
 * the deal already holds six sha-less copies of matches nothing and
 * becomes the seventh. Deal b296dec2 is exactly that: six rows for
 * 2025_TaxReturn.pdf, 1,013,618 bytes each, every sha256 NULL.
 *
 * When the deal holds a hash-less row with an identical filename AND an
 * identical byte count, it is the same file. Deliberately narrower than
 * the collapse used in the borrower's list view: this one only ever looks
 * at rows with NO hash. A row that HAS a hash and did not match the
 * incoming one is genuinely different content, and matching it on filename
 * would discard a real document — a borrower re-uploading a corrected
 * version under the same name is a normal thing to do.
 */
export async function findExistingDocByNameAndSize(args: {
  sb: ReturnType<typeof supabaseAdmin>;
  dealId: string;
  filename: string | null | undefined;
  sizeBytes: number | null | undefined;
}): Promise<{ id: string; storage_bucket: string | null; storage_path: string | null } | null> {
  const filename = (args.filename ?? "").trim();
  if (!filename || args.sizeBytes == null || args.sizeBytes <= 0) return null;

  const { data, error } = await args.sb
    .from("deal_documents")
    .select("id, storage_bucket, storage_path")
    .eq("deal_id", args.dealId)
    .is("sha256", null)
    .eq("original_filename", filename)
    .eq("size_bytes", args.sizeBytes)
    .neq("status", "withdrawn")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: String(data.id),
    storage_bucket: data.storage_bucket ?? null,
    storage_path: data.storage_path ?? null,
  };
}
