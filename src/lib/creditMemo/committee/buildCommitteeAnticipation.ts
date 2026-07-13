// Server-only assembler for the Committee Anticipation Engine.
//
// Loads canonical inputs (snapshot, memo input package, research, pricing,
// policy exceptions, covenant package presence) and runs the pure
// evaluator. Returns the report.
//
// Reuses already-built loaders where possible:
//   • buildMemoInputPackage — memo-input layer signals
//   • loadResearchForMemo   — research narrative + trust grade

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildMemoInputPackage } from "@/lib/creditMemo/inputs/buildMemoInputPackage";
import { loadResearchForMemo } from "@/lib/creditMemo/canonical/loadResearchForMemo";
import { evaluateCommitteeAnticipation } from "./evaluateCommitteeAnticipation";
import type {
  CommitteeAnticipationReport,
  CommitteeEngineInputs,
} from "./types";

export type BuildCommitteeAnticipationResult =
  | { ok: true; report: CommitteeAnticipationReport; bankId: string }
  | {
      ok: false;
      reason: "tenant_mismatch" | "load_failed";
      error?: string;
    };

export async function buildCommitteeAnticipation(args: {
  dealId: string;
}): Promise<BuildCommitteeAnticipationResult> {
  const access = await ensureDealBankAccess(args.dealId);
  if (!access.ok) {
    return { ok: false, reason: "tenant_mismatch", error: access.error };
  }
  const { bankId } = access;
  const sb = supabaseAdmin();

  const [memoPackage, snapshot, research, pricing, policyExceptionsCount, covenantPresent] =
    await Promise.all([
      buildMemoInputPackage({ dealId: args.dealId, runReconciliation: false }),
      loadLatestSnapshot(sb, args.dealId, bankId),
      loadResearchForMemo({ dealId: args.dealId, bankId }).catch(() => null),
      loadPricingDecision(sb, args.dealId),
      loadOpenPolicyExceptionsCount(sb, args.dealId),
      loadCovenantPackagePresent(sb, args.dealId),
    ]);

  const inputs: CommitteeEngineInputs = {
    dealId: args.dealId,
    metrics: extractMetrics(snapshot),
    memoInput: extractMemoInput(memoPackage),
    research: research
      ? {
          gate_passed: !!research.trust_grade && research.trust_grade !== "research_failed",
          trust_grade: (research.trust_grade as
            | "committee_grade"
            | "preliminary"
            | "manual_review_required"
            | "research_failed"
            | undefined) ?? null,
          quality_score: typeof research.quality_score === "number" ? research.quality_score : null,
          industry: extractIndustryFromResearch(research),
        }
      : null,
    pricing,
    openPolicyExceptionsCount: policyExceptionsCount,
    covenantPackagePresent: covenantPresent,
  };

  const report = evaluateCommitteeAnticipation(inputs);
  return { ok: true, report, bankId };
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

async function loadLatestSnapshot(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
): Promise<any | null> {
  // Try the v1 table first; fall back to legacy if needed.
  for (const table of ["financial_snapshots", "deal_financial_snapshots"]) {
    try {
      const { data } = await (sb as any)
        .from(table)
        .select("snapshot_json, created_at")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && (data as any).snapshot_json) {
        return (data as any).snapshot_json;
      }
    } catch {
      // try next
    }
  }
  return null;
}

async function loadPricingDecision(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<{ decided: boolean; rate_initial_pct: number | null }> {
  try {
    const { data } = await (sb as any)
      .from("pricing_decisions")
      .select("rate_initial_pct, decided_at")
      .eq("deal_id", dealId)
      .maybeSingle();
    if (!data) return { decided: false, rate_initial_pct: null };
    return {
      decided: true,
      rate_initial_pct:
        typeof (data as any).rate_initial_pct === "number"
          ? (data as any).rate_initial_pct
          : null,
    };
  } catch {
    return { decided: false, rate_initial_pct: null };
  }
}

async function loadOpenPolicyExceptionsCount(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<number> {
  try {
    // deal_policy_exceptions has no bank_id column — deal_id alone is the
    // correct scope (deals.id is globally unique and already bank-verified
    // by the caller). NOTE: this previously queried a nonexistent
    // "policy_exceptions" table, which silently always returned 0.
    const { count, error } = await (sb as any)
      .from("deal_policy_exceptions")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "open");
    if (error) throw error;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function loadCovenantPackagePresent(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<boolean> {
  try {
    // buddy_covenant_packages has no bank_id column either. NOTE: this
    // previously queried a nonexistent "covenant_packages" table, which
    // silently always returned false.
    const { count, error } = await (sb as any)
      .from("buddy_covenant_packages")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);
    if (error) throw error;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function n(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function metric(snap: any, key: string): number | null {
  if (!snap || typeof snap !== "object") return null;
  const m = snap[key];
  if (!m || typeof m !== "object") return null;
  return n((m as any).value_num);
}

function extractMetrics(snap: any): CommitteeEngineInputs["metrics"] {
  return {
    dscr: metric(snap, "dscr"),
    dscr_stressed_300bps: metric(snap, "dscr_stressed_300bps"),
    cash_flow_available: metric(snap, "cash_flow_available"),
    annual_debt_service: metric(snap, "annual_debt_service"),
    excess_cash_flow: metric(snap, "excess_cash_flow"),
    global_cash_flow:
      metric(snap, "gcf_global_cash_flow") ?? metric(snap, "global_cash_flow"),
    gcf_dscr: metric(snap, "gcf_dscr"),
    revenue_ttm: metric(snap, "revenue") ?? metric(snap, "total_income_ttm"),
    ebitda_ttm: metric(snap, "ebitda"),
    net_income_ttm: metric(snap, "net_income"),
    debt_to_equity: metric(snap, "debt_to_equity"),
    total_liabilities: metric(snap, "total_liabilities"),
    net_worth: metric(snap, "net_worth"),
    collateral_gross_value: metric(snap, "collateral_gross_value"),
    collateral_discounted_value: metric(snap, "collateral_discounted_value"),
    collateral_coverage: metric(snap, "collateral_coverage"),
    ltv_gross: metric(snap, "ltv_gross"),
    ltv_net: metric(snap, "ltv_net"),
    loan_amount: metric(snap, "bank_loan_total"),
    bank_loan_total: metric(snap, "bank_loan_total"),
    pfs_total_assets: metric(snap, "pfs_total_assets"),
    pfs_net_worth: metric(snap, "pfs_net_worth"),
  };
}

function extractMemoInput(
  pkgResult: Awaited<ReturnType<typeof buildMemoInputPackage>>,
): CommitteeEngineInputs["memoInput"] {
  if (!pkgResult.ok) {
    return {
      ready: false,
      blockerCodes: ["memo_input_readiness_missing"],
      openConflictsCount: 0,
      borrowerStoryCustomers: null,
      borrowerStoryConcentration: null,
      borrowerStoryRevenueModel: null,
      borrowerStoryRisks: null,
      managementProfilesCount: 0,
      collateralItemsCount: 0,
      collateralWithValueCount: 0,
    };
  }
  const pkg = pkgResult.package;
  const story = pkg.borrower_story;
  const openConflicts = pkg.conflicts.filter((c) => c.status === "open").length;
  const collateralWithValue = pkg.collateral_items.filter(
    (c) =>
      (c.market_value !== null && c.market_value > 0) ||
      (c.appraised_value !== null && c.appraised_value > 0) ||
      (c.discounted_value !== null && c.discounted_value > 0),
  ).length;

  return {
    ready: pkg.readiness.ready,
    blockerCodes: pkg.readiness.blockers.map((b) => b.code),
    openConflictsCount: openConflicts,
    borrowerStoryCustomers: story?.customers ?? null,
    borrowerStoryConcentration: story?.customer_concentration ?? null,
    borrowerStoryRevenueModel: story?.revenue_model ?? null,
    borrowerStoryRisks: story?.key_risks ?? null,
    managementProfilesCount: pkg.management_profiles.length,
    collateralItemsCount: pkg.collateral_items.length,
    collateralWithValueCount: collateralWithValue,
  };
}

function extractIndustryFromResearch(research: any): string | null {
  if (!research || typeof research !== "object") return null;
  // Common fields where industry might surface.
  const industry =
    research.industry ??
    research.naics_label ??
    research.industry_overview ??
    null;
  if (typeof industry !== "string") return null;
  return industry.length > 0 ? industry : null;
}
