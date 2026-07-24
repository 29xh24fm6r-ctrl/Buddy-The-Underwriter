import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "./types";

/** Referral-source analytics — spec section 7.2. */

export type MonthlyTrendPoint = { month: string; leadsReferred: number };

export type ReferralSourceAnalytics = {
  organizationId: string;
  leadsReferred: number;
  qualifiedLeads: number;
  dealsConverted: number;
  dealsFunded: number;
  loanVolumeCents: number;
  grossRevenueCents: number;
  netRevenueCents: number;
  conversionRate: number | null;
  avgDealSizeCents: number | null;
  avgTimeToConversionDays: number | null;
  avgTimeToFundingDays: number | null;
  lostReasons: string[];
  trendByMonth: MonthlyTrendPoint[];
  lastReferralAt: string | null;
  lastContactAt: string | null;
  activeOpportunities: number;
  referralFeeObligationsCents: number;
};

const TERMINAL_STAGES = new Set(["post_close", "withdrawn", "declined", "lost"]);

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export async function computeReferralSourceAnalytics(
  bankId: string,
  organizationId: string,
  sb: SB = supabaseAdmin(),
): Promise<ReferralSourceAnalytics> {
  const disqualifyingStatuses = new Set(["new", "unresponsive"]);

  const { data: leadsData } = await sb
    .from("brokerage_leads")
    .select("id, status, created_at, converted_at, converted_deal_id, lost_reason, disqualification_reason")
    .eq("bank_id", bankId)
    .eq("referral_source_org_id", organizationId);
  const leads = (leadsData ?? []) as Array<{
    id: string;
    status: string | null;
    created_at: string;
    converted_at: string | null;
    converted_deal_id: string | null;
    lost_reason: string | null;
    disqualification_reason: string | null;
  }>;

  const leadsReferred = leads.length;
  const qualifiedLeads = leads.filter((l) => l.status && !disqualifyingStatuses.has(l.status)).length;
  const dealsConverted = leads.filter((l) => l.converted_deal_id != null).length;

  const conversionDurations = leads
    .filter((l) => l.converted_at != null)
    .map((l) => (new Date(l.converted_at as string).getTime() - new Date(l.created_at).getTime()) / (24 * 3600 * 1000));
  const avgTimeToConversionDays =
    conversionDurations.length > 0 ? Math.round(conversionDurations.reduce((a, b) => a + b, 0) / conversionDurations.length) : null;

  const lostReasons = leads
    .map((l) => l.lost_reason ?? l.disqualification_reason)
    .filter((r): r is string => Boolean(r));

  const trendMap = new Map<string, number>();
  for (const l of leads) {
    const k = monthKey(l.created_at);
    trendMap.set(k, (trendMap.get(k) ?? 0) + 1);
  }
  const trendByMonth = Array.from(trendMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, leadsReferredCount]) => ({ month, leadsReferred: leadsReferredCount }));

  const lastReferralAt = leads.map((l) => l.created_at).sort().pop() ?? null;

  const { data: dealsData } = await sb
    .from("deals")
    .select("id, loan_amount, brokerage_stage, created_at")
    .eq("bank_id", bankId)
    .eq("referral_source_org_id", organizationId);
  const deals = (dealsData ?? []) as Array<{ id: string; loan_amount: number | null; brokerage_stage: string | null; created_at: string }>;
  const dealsFunded = deals.filter((d) => d.brokerage_stage === "funded" || d.brokerage_stage === "post_close").length;
  const loanVolumeCents = deals.reduce((sum, d) => sum + Math.round((d.loan_amount ?? 0) * 100), 0);
  const avgDealSizeCents = deals.length > 0 ? Math.round(loanVolumeCents / deals.length) : null;
  const activeOpportunities = deals.filter((d) => d.brokerage_stage && !TERMINAL_STAGES.has(d.brokerage_stage)).length;

  const { data: fundingVerifications } = await sb
    .from("brokerage_funding_verifications")
    .select("deal_id, funded_at")
    .in("deal_id", deals.map((d) => d.id).length > 0 ? deals.map((d) => d.id) : ["__none__"])
    .eq("status", "verified");
  const fundingByDeal = new Map(((fundingVerifications ?? []) as Array<{ deal_id: string; funded_at: string }>).map((v) => [v.deal_id, v.funded_at]));
  const fundingDurations = deals
    .filter((d) => fundingByDeal.has(d.id))
    .map((d) => (new Date(fundingByDeal.get(d.id) as string).getTime() - new Date(d.created_at).getTime()) / (24 * 3600 * 1000));
  const avgTimeToFundingDays =
    fundingDurations.length > 0 ? Math.round(fundingDurations.reduce((a, b) => a + b, 0) / fundingDurations.length) : null;

  let grossRevenueCents = 0;
  let netRevenueCents = 0;
  let referralFeeObligationsCents = 0;
  if (deals.length > 0) {
    const dealIds = deals.map((d) => d.id);
    const { data: fees } = await sb.from("brokerage_fee_ledger").select("deal_id, amount_cents, status").in("deal_id", dealIds);
    const earnedOrFunded = ((fees ?? []) as Array<{ amount_cents: number | null; status: string | null }>).filter(
      (f) => f.status === "earned" || f.status === "funded",
    );
    grossRevenueCents = earnedOrFunded.reduce((sum, f) => sum + (f.amount_cents ?? 0), 0);

    const { data: splits } = await sb
      .from("brokerage_commission_splits")
      .select("deal_id, amount_cents, status, split_type, payee_org_id")
      .in("deal_id", dealIds);
    const splitRows = (splits ?? []) as Array<{
      amount_cents: number | null;
      status: string | null;
      split_type: string | null;
      payee_org_id: string | null;
    }>;
    const paidOutCents = splitRows.reduce((sum, s) => sum + (s.amount_cents ?? 0), 0);
    netRevenueCents = grossRevenueCents - paidOutCents;
    referralFeeObligationsCents = splitRows
      .filter((s) => s.split_type === "referral_partner" && s.payee_org_id === organizationId && s.status !== "paid")
      .reduce((sum, s) => sum + (s.amount_cents ?? 0), 0);
  }

  const { data: activities } = await sb
    .from("crm_activities")
    .select("happens_at")
    .eq("bank_id", bankId)
    .eq("target_organization_id", organizationId)
    .order("happens_at", { ascending: false })
    .limit(1);
  const lastContactAt = ((activities ?? [])[0] as { happens_at: string } | undefined)?.happens_at ?? null;

  return {
    organizationId,
    leadsReferred,
    qualifiedLeads,
    dealsConverted,
    dealsFunded,
    loanVolumeCents,
    grossRevenueCents,
    netRevenueCents,
    conversionRate: leadsReferred > 0 ? dealsConverted / leadsReferred : null,
    avgDealSizeCents,
    avgTimeToConversionDays,
    avgTimeToFundingDays,
    lostReasons,
    trendByMonth,
    lastReferralAt,
    lastContactAt,
    activeOpportunities,
    referralFeeObligationsCents,
  };
}
