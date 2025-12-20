import type { SupabaseClient } from "@supabase/supabase-js";

export async function ensureDealHasBank(opts: {
  supabase: SupabaseClient;
  dealId: string;
  defaultBankCode?: string;
}) {
  const { supabase, dealId, defaultBankCode = "OGB" } = opts;

  // 1) Load the deal
  const { data: deal, error: dErr } = await supabase
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .limit(1)
    .maybeSingle();

  if (dErr) throw new Error(`deal_load_failed: ${dErr.message}`);
  if (!deal) throw new Error(`deal_not_found: ${dealId}`);

  if (deal.bank_id) return { ok: true, bankId: deal.bank_id as string, updated: false };

  // 2) Get default bank
  const { data: bank, error: bErr } = await supabase
    .from("banks")
    .select("id, code")
    .eq("code", defaultBankCode)
    .limit(1)
    .maybeSingle();

  if (bErr) throw new Error(`bank_lookup_failed: ${bErr.message}`);
  if (!bank) throw new Error(`default_bank_missing: ${defaultBankCode}`);

  // 3) Assign to deal
  const { error: uErr } = await supabase
    .from("deals")
    .update({ bank_id: bank.id })
    .eq("id", dealId);

  if (uErr) throw new Error(`deal_bank_assign_failed: ${uErr.message}`);

  return { ok: true, bankId: bank.id as string, updated: true };
}
