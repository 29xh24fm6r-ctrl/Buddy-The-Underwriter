import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRoleConfig, type GatewayRole } from "@/lib/ai/roleConfig";
import { PACKAGE_ROLE_HEADROOM, packageBudgetBlockers } from "./packageBudgetPolicy";
import type { PackageCapacity } from "../borrowerPackageCheckState";
export { PACKAGE_ROLE_HEADROOM } from "./packageBudgetPolicy";

/** Borrower-safe, current availability. This does not reserve or reset capacity. */
export async function readPackageCapacity(args: { dealId: string; bankId: string }, sb: SupabaseClient = supabaseAdmin()): Promise<PackageCapacity> {
  try {
    await assertPackageBudgetAvailable(args, sb);
    return { available: true, message: null };
  } catch {
    return { available: false, message: "Package preparation is paused because processing capacity is unavailable or could not be verified. Your information is saved. You can check saved package evidence without AI, then refresh status before preparing." };
  }
}

// Read-only admission. Atomic gateway reservations remain the hard enforcement
// under concurrent work. No budget caps or usage ledgers are changed here.
export async function assertPackageBudgetAvailable(args: {
  dealId: string; bankId: string; bundleId?: string;
}, sb: SupabaseClient = supabaseAdmin()) {
  const day = new Date().toISOString().slice(0, 10);
  const { data: deal, error: dealError } = await sb.from("deals").select("is_test")
    .eq("id", args.dealId).eq("bank_id", args.bankId).single();
  if (dealError || !deal) throw new Error("budget_unavailable: package tenancy could not be checked");
  const { data, error } = await sb.from("ai_gateway_daily_budgets")
    .select("role,tokens_consumed,tokens_reserved").eq("usage_day", day);
  if (error) throw new Error(`budget_unavailable: ${error.message}`);
  async function totals(scope: "qa" | "run") {
    const result: Record<string, number> = {};
    // The ledger can exceed PostgREST's page limit. Never undercount a busy day.
    for (let offset = 0; ; offset += 1000) {
      let q = sb.from("ai_gateway_budget_reservations").select("id,role,actual_tokens,reserved_tokens")
        .order("id").range(offset, offset + 999);
      q = scope === "qa" ? q.eq("is_qa", true).eq("usage_day", day) : q.eq("trident_run_id", args.bundleId!);
      const page = await q;
      if (page.error || !page.data) throw new Error("budget_unavailable: reservation ledger could not be checked");
      for (const row of page.data) result[row.role] = (result[row.role] ?? 0) + Number(row.actual_tokens ?? row.reserved_tokens);
      if (page.data.length < 1000) return result;
    }
  }
  const [qa, run] = await Promise.all([
    deal.is_test === true ? totals("qa") : Promise.resolve({} as Record<string, number>),
    args.bundleId ? totals("run") : Promise.resolve({} as Record<string, number>),
  ]);
  const blockers = Object.entries(PACKAGE_ROLE_HEADROOM).flatMap(([role, required]) => {
    const used = data?.find(row => row.role === role);
    return packageBudgetBlockers({ role, required, isTest: deal.is_test === true,
      dailyLimit: getRoleConfig(role as GatewayRole).dailyTokenBudget,
      consumed: Number(used?.tokens_consumed ?? 0), reserved: Number(used?.tokens_reserved ?? 0),
      qaUsed: qa[role] ?? 0, runUsed: run[role] ?? 0 });
  });
  if (blockers.length) throw new Error(blockers.join("\n"));
}
