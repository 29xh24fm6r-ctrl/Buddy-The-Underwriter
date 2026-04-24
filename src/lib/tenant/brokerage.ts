import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Buddy Brokerage tenant helpers. See brokerage-master-plan.md §3.
 *
 * The brokerage is a singleton tenant on the existing banks table,
 * discriminated by bank_kind='brokerage'. All branches in application
 * code go through getBrokerageBankId / isBrokerageTenant / isBrokerageKind.
 */

const BROKERAGE_CODE = "BUDDY_BROKERAGE";
let cachedBrokerageId: string | null = null;

export async function getBrokerageBankId(): Promise<string> {
  if (cachedBrokerageId) return cachedBrokerageId;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("banks")
    .select("id")
    .eq("code", BROKERAGE_CODE)
    .single();
  if (error || !data) {
    throw new Error(
      `Brokerage tenant not found. Migration 20260425_brokerage_tenant_model.sql must be applied. Error: ${error?.message}`,
    );
  }
  cachedBrokerageId = data.id;
  return data.id;
}

export async function isBrokerageTenant(bankId: string): Promise<boolean> {
  const brokerageId = await getBrokerageBankId();
  return bankId === brokerageId;
}

export async function isBrokerageKind(bankId: string): Promise<boolean> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("banks")
    .select("bank_kind")
    .eq("id", bankId)
    .single();
  return data?.bank_kind === "brokerage";
}
