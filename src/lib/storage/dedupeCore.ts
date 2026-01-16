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
