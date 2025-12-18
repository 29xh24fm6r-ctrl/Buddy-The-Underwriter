import { supabaseAdmin } from "@/lib/supabase/admin";

export async function updateBorrowerAttachmentMeta(input: {
  application_id: string;
  file_key: string;
  patch: Record<string, any>;
}) {
  const sb = supabaseAdmin();

  // Fetch existing meta so we can merge safely
  const { data: row, error: getErr } = await sb
    .from("borrower_attachments")
    .select("meta")
    .eq("application_id", input.application_id)
    .eq("file_key", input.file_key)
    .single();

  if (getErr) throw new Error(`attachment_meta_load_failed: ${getErr.message}`);

  const current = (row?.meta ?? {}) as Record<string, any>;
  const next = { ...current, ...input.patch };

  const { error: upErr } = await sb
    .from("borrower_attachments")
    .update({ meta: next })
    .eq("application_id", input.application_id)
    .eq("file_key", input.file_key);

  if (upErr) throw new Error(`attachment_meta_update_failed: ${upErr.message}`);
}
