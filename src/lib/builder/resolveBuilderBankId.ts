import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function resolveBuilderBankId(
  sb: ReturnType<typeof supabaseAdmin> = supabaseAdmin(),
): Promise<string> {
  const envBankId = process.env.BUDDY_BUILDER_BANK_ID ?? "";
  if (envBankId) return envBankId;

  const { data, error } = await sb
    .from("banks")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) {
    throw new Error("builder_bank_unresolved");
  }

  return String(data.id);
}
