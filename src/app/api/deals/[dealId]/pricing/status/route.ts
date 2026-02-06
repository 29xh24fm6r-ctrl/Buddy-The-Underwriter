import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal || deal.bank_id !== bankId) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    // Run all queries in parallel
    const [quotesRes, lockedRes, rateRes, snapshotRes, scenariosRes, decisionRes] = await Promise.all([
      // Legacy: total quote count
      sb
        .from("deal_pricing_quotes")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId),
      // Legacy: locked quote
      sb
        .from("deal_pricing_quotes")
        .select("id, all_in_rate_pct, spread_bps, base_rate_pct, locked_at, lock_reason, status")
        .eq("deal_id", dealId)
        .eq("status", "locked")
        .order("locked_at", { ascending: false, nullsFirst: false })
        .limit(1),
      // Rate snapshots
      sb
        .from("rate_index_snapshots")
        .select("id, index_code, index_rate_pct, as_of_date, source")
        .eq("deal_id", dealId)
        .order("created_at", { ascending: false })
        .limit(3),
      // Financial snapshot existence
      sb
        .from("financial_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .eq("bank_id", bankId),
      // Pricing scenarios
      sb
        .from("pricing_scenarios")
        .select("id, scenario_key, product_type, created_at")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false }),
      // Pricing decision
      sb
        .from("pricing_decisions")
        .select("id, decision, pricing_scenario_id, decided_at, decided_by")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .maybeSingle(),
    ]);

    const totalQuotes = quotesRes.count ?? 0;
    const lockedQuote = (lockedRes.data as any[])?.[0] ?? null;
    const rateSnapshots = (rateRes.data as any[]) ?? [];
    const hasSnapshot = (snapshotRes.count ?? 0) > 0;
    const scenarios = (scenariosRes.data as any[]) ?? [];
    const decision = decisionRes.data ?? null;

    return NextResponse.json({
      ok: true,
      dealId,
      has_snapshot: hasSnapshot,
      scenarios_count: scenarios.length,
      scenarios: scenarios.map((s: any) => ({
        id: s.id,
        scenario_key: s.scenario_key,
        product_type: s.product_type,
        created_at: s.created_at,
      })),
      decision_exists: !!decision,
      decision: decision ? {
        id: decision.id,
        decision: decision.decision,
        pricing_scenario_id: decision.pricing_scenario_id,
        decided_at: decision.decided_at,
        decided_by: decision.decided_by,
      } : null,
      pipeline_blocked: !decision,
      // Legacy quote system (backward compat)
      totalQuotes,
      lockedQuote,
      hasLockedQuote: !!lockedQuote,
      rateSnapshots,
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/pricing/status]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
