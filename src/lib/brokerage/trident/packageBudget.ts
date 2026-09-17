import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRoleConfig, type GatewayRole } from "@/lib/ai/roleConfig";

// Admission headroom, not a claim about billed usage. Atomic gateway reservations
// remain the hard enforcement under concurrent work; never raise role caps here.
export const PACKAGE_ROLE_HEADROOM = { generator: 150000, underwriter: 150000, verifier: 150000 } as const;
export async function assertPackageBudgetAvailable() {
  const sb = supabaseAdmin();
  const { data, error } = await sb.from("ai_gateway_daily_budgets")
    .select("role,tokens_consumed,tokens_reserved").eq("usage_day", new Date().toISOString().slice(0,10));
  if (error) throw new Error(`budget_unavailable: ${error.message}`);
  for (const [role, required] of Object.entries(PACKAGE_ROLE_HEADROOM)) {
    const used = data?.find(row => row.role === role);
    const available = getRoleConfig(role as GatewayRole).dailyTokenBudget - Number(used?.tokens_consumed ?? 0) - Number(used?.tokens_reserved ?? 0);
    if (available < required) throw new Error(`budget_unavailable: ${role} has ${available} tokens of headroom; package admission needs ${required}. Resume after capacity is available; no automatic retries.`);
  }
}
