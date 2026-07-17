import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "./types";

/**
 * Pipeline and revenue forecasting — spec section 7.5. "Forecast
 * assumptions must be visible": every result carries the exact
 * stage-probability weights and fee-rate assumption used, so a viewer
 * can see how a number was derived rather than trusting an opaque total.
 * Deal-level "probability" is intentionally never a stored column (see
 * the PR5 migration header) -- it is this deterministic weight table,
 * computed fresh on every call.
 */

export const DEAL_STAGE_PROBABILITY_WEIGHTS: Record<string, number> = {
  intake: 0.05,
  discovery: 0.1,
  qualification: 0.15,
  engagement: 0.2,
  application: 0.3,
  document_collection: 0.35,
  financial_analysis: 0.4,
  packaging: 0.45,
  lender_strategy: 0.5,
  submitted: 0.55,
  lender_review: 0.6,
  term_sheet: 0.75,
  underwriting: 0.8,
  commitment: 0.9,
  closing: 0.95,
  funded: 1,
  post_close: 1,
  on_hold: 0.2,
};

const LEAD_STATUS_DEFAULT_PROBABILITY: Record<string, number> = {
  new: 0.05,
  contacted: 0.1,
  qualifying: 0.2,
  qualified: 0.35,
  nurture: 0.1,
  converted: 1,
};

const COMMITTED_DEAL_STAGES = new Set(["commitment", "closing"]);
const TERMINAL_DEAL_STAGES = new Set(["post_close", "withdrawn", "declined", "lost", "funded"]);
const TERMINAL_LEAD_STATUSES = new Set(["converted", "nurture", "unresponsive", "disqualified", "withdrawn", "lost"]);

export type ForecastBreakdown = { key: string; label: string; bestCaseCents: number; expectedCaseCents: number; expectedRevenueCents: number };

export type PipelineForecast = {
  bestCaseLoanVolumeCents: number;
  expectedLoanVolumeCents: number;
  committedLoanVolumeCents: number;
  expectedGrossRevenueCents: number;
  byMonth: ForecastBreakdown[];
  byOwner: ForecastBreakdown[];
  bySource: ForecastBreakdown[];
  byLoanType: ForecastBreakdown[];
  assumptions: {
    dealStageWeights: Record<string, number>;
    leadStatusDefaultWeights: Record<string, number>;
    feeRateBpsUsed: number;
    committedStages: string[];
  };
};

type ForecastItem = {
  key: string;
  loanAmountCents: number;
  probability: number;
  monthKey: string;
  ownerKey: string;
  sourceKey: string;
  loanTypeKey: string;
  committed: boolean;
};

function monthKey(iso: string | null): string {
  if (!iso) return "unscheduled";
  return iso.slice(0, 7);
}

function groupBy(items: ForecastItem[], keyFn: (i: ForecastItem) => { key: string; label: string }, feeRateBps: number): ForecastBreakdown[] {
  const groups = new Map<string, ForecastBreakdown>();
  for (const item of items) {
    const { key, label } = keyFn(item);
    const g = groups.get(key) ?? { key, label, bestCaseCents: 0, expectedCaseCents: 0, expectedRevenueCents: 0 };
    g.bestCaseCents += item.loanAmountCents;
    g.expectedCaseCents += Math.round(item.loanAmountCents * item.probability);
    g.expectedRevenueCents += Math.round(item.loanAmountCents * item.probability * (feeRateBps / 10000));
    groups.set(key, g);
  }
  return Array.from(groups.values()).sort((a, b) => b.expectedCaseCents - a.expectedCaseCents);
}

export async function computePipelineForecast(bankId: string, sb: SB = supabaseAdmin()): Promise<PipelineForecast> {
  const { data: feeConfig } = await sb.from("brokerage_fee_config").select("lender_referral_fee_min_bps, lender_referral_fee_max_bps").eq("status", "active").limit(1).maybeSingle();
  const cfg = feeConfig as { lender_referral_fee_min_bps: number | null; lender_referral_fee_max_bps: number | null } | null;
  const feeRateBps = cfg ? Math.round(((cfg.lender_referral_fee_min_bps ?? 100) + (cfg.lender_referral_fee_max_bps ?? 200)) / 2) : 150;

  const { data: dealsData } = await sb
    .from("deals")
    .select("id, loan_amount, brokerage_stage, referral_source_org_id, created_at")
    .eq("bank_id", bankId);
  const deals = ((dealsData ?? []) as Array<{ id: string; loan_amount: number | null; brokerage_stage: string | null; referral_source_org_id: string | null; created_at: string }>).filter(
    (d) => d.brokerage_stage && !TERMINAL_DEAL_STAGES.has(d.brokerage_stage),
  );
  const dealIds = deals.map((d) => d.id);

  const { data: brokerParticipants } = await sb.from("deal_participants").select("deal_id, clerk_user_id").eq("role", "broker").eq("is_active", true).in("deal_id", dealIds.length > 0 ? dealIds : ["__none__"]);
  const brokerByDeal = new Map(((brokerParticipants ?? []) as Array<{ deal_id: string; clerk_user_id: string }>).map((p) => [p.deal_id, p.clerk_user_id]));

  const { data: workflows } = await sb.from("brokerage_closing_workflows").select("deal_id, target_close_date").in("deal_id", dealIds.length > 0 ? dealIds : ["__none__"]);
  const closeDateByDeal = new Map(((workflows ?? []) as Array<{ deal_id: string; target_close_date: string | null }>).map((w) => [w.deal_id, w.target_close_date]));

  const { data: convertedLeads } = await sb.from("brokerage_leads").select("converted_deal_id, loan_program").not("converted_deal_id", "is", null);
  const loanProgramByDeal = new Map(((convertedLeads ?? []) as Array<{ converted_deal_id: string; loan_program: string | null }>).map((l) => [l.converted_deal_id, l.loan_program]));

  const dealItems: ForecastItem[] = deals.map((d) => ({
    key: `deal:${d.id}`,
    loanAmountCents: Math.round((d.loan_amount ?? 0) * 100),
    probability: DEAL_STAGE_PROBABILITY_WEIGHTS[d.brokerage_stage as string] ?? 0.1,
    monthKey: monthKey(closeDateByDeal.get(d.id) ?? d.created_at),
    ownerKey: brokerByDeal.get(d.id) ?? "unassigned",
    sourceKey: d.referral_source_org_id ?? "unattributed",
    loanTypeKey: loanProgramByDeal.get(d.id) ?? "unspecified",
    committed: COMMITTED_DEAL_STAGES.has(d.brokerage_stage as string),
  }));

  const { data: leadsData } = await sb
    .from("brokerage_leads")
    .select("id, loan_amount_requested, status, referral_source_org_id, owner_clerk_user_id, expected_conversion_date, loan_program, conversion_probability_pct, created_at")
    .eq("bank_id", bankId);
  const leads = ((leadsData ?? []) as Array<{
    id: string;
    loan_amount_requested: number | null;
    status: string | null;
    referral_source_org_id: string | null;
    owner_clerk_user_id: string | null;
    expected_conversion_date: string | null;
    loan_program: string | null;
    conversion_probability_pct: number | null;
    created_at: string;
  }>).filter((l) => !l.status || !TERMINAL_LEAD_STATUSES.has(l.status));

  const leadItems: ForecastItem[] = leads.map((l) => ({
    key: `lead:${l.id}`,
    loanAmountCents: Math.round((l.loan_amount_requested ?? 0) * 100),
    probability: l.conversion_probability_pct != null ? l.conversion_probability_pct / 100 : LEAD_STATUS_DEFAULT_PROBABILITY[l.status ?? "new"] ?? 0.05,
    monthKey: monthKey(l.expected_conversion_date ?? l.created_at),
    ownerKey: l.owner_clerk_user_id ?? "unassigned",
    sourceKey: l.referral_source_org_id ?? "unattributed",
    loanTypeKey: l.loan_program ?? "unspecified",
    committed: (l.conversion_probability_pct ?? 0) >= 80,
  }));

  const allItems = [...dealItems, ...leadItems];

  const bestCaseLoanVolumeCents = allItems.reduce((sum, i) => sum + i.loanAmountCents, 0);
  const expectedLoanVolumeCents = allItems.reduce((sum, i) => sum + Math.round(i.loanAmountCents * i.probability), 0);
  const committedLoanVolumeCents = allItems.filter((i) => i.committed).reduce((sum, i) => sum + i.loanAmountCents, 0);
  const expectedGrossRevenueCents = allItems.reduce((sum, i) => sum + Math.round(i.loanAmountCents * i.probability * (feeRateBps / 10000)), 0);

  return {
    bestCaseLoanVolumeCents,
    expectedLoanVolumeCents,
    committedLoanVolumeCents,
    expectedGrossRevenueCents,
    byMonth: groupBy(allItems, (i) => ({ key: i.monthKey, label: i.monthKey }), feeRateBps),
    byOwner: groupBy(allItems, (i) => ({ key: i.ownerKey, label: i.ownerKey }), feeRateBps),
    bySource: groupBy(allItems, (i) => ({ key: i.sourceKey, label: i.sourceKey }), feeRateBps),
    byLoanType: groupBy(allItems, (i) => ({ key: i.loanTypeKey, label: i.loanTypeKey }), feeRateBps),
    assumptions: {
      dealStageWeights: DEAL_STAGE_PROBABILITY_WEIGHTS,
      leadStatusDefaultWeights: LEAD_STATUS_DEFAULT_PROBABILITY,
      feeRateBpsUsed: feeRateBps,
      committedStages: Array.from(COMMITTED_DEAL_STAGES),
    },
  };
}
