/**
 * Config Engine — Config Loader
 *
 * Loads the active bank configuration from the database.
 * Returns a frozen BankConfig or null if no active config exists.
 *
 * PHASE 8: DB read only — no mutations, no side effects.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { deepFreeze } from "@/lib/utils/deepFreeze";
import type { BankConfig } from "./types";

/**
 * Load the active bank config for a given bank.
 * Returns null if no active config version exists (system defaults apply).
 */
export async function loadActiveBankConfig(
  bankId: string,
): Promise<BankConfig | null> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("bank_config_versions")
    .select("*")
    .eq("bank_id", bankId)
    .eq("active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return deepFreeze({
    id: data.id,
    bankId: data.bank_id,
    version: data.version,
    policy: data.policy_json ?? {},
    stress: data.stress_json ?? {},
    pricing: data.pricing_json ?? {},
  }) as BankConfig;
}
