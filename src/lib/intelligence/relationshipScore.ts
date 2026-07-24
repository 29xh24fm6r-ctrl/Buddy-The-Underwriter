import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "./types";

/**
 * Multi-factor organization relationship score — spec section 7.1.
 * Replaces the CRM dashboard's last-contact-only "health" stamp
 * (src/app/api/admin/brokerage/crm/organizations/route.ts:healthFor)
 * with component values that are individually visible, not an opaque
 * blended number. Every component is computed fresh from source tables
 * on every call — there is no cached score row, so there is nothing to
 * go stale or drift from the underlying facts.
 */

export type RelationshipScoreComponents = {
  recencyScore: number; // 0-100, days-since-last-contact decayed
  daysSinceLastContact: number | null;
  engagementScore: number; // 0-100, activity count in trailing 90 days
  activityCount90d: number;
  referralVolume12mo: number;
  qualifiedReferralRate: number | null; // 0-1
  conversionRate: number | null; // 0-1
  fundedVolumeCents: number;
  revenueGeneratedCents: number;
  responsiveness: number | null; // 0-1, inbound / total activity in trailing 180 days
  activePipelineCount: number;
  referralTrend: "increasing" | "stable" | "declining" | "no_data";
  concentrationRiskPct: number | null; // this org's share of bank-wide referred loan volume, trailing 12mo
  outstandingCommitments: number;
};

export type RelationshipScore = {
  organizationId: string;
  components: RelationshipScoreComponents;
  overallScore: number; // 0-100, weighted average of the 0-100-normalized components
  weights: Record<string, number>;
};

const WEIGHTS = {
  recency: 0.2,
  engagement: 0.15,
  referralVolume: 0.15,
  qualifiedReferralRate: 0.1,
  conversionRate: 0.15,
  responsiveness: 0.1,
  concentration: 0.05, // higher concentration = lower score contribution (risk)
  outstandingCommitments: 0.1, // more open commitments = lower score contribution
};

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (24 * 3600 * 1000));
}

function recencyToScore(days: number | null): number {
  if (days == null) return 0;
  if (days <= 7) return 100;
  if (days <= 30) return 80;
  if (days <= 60) return 55;
  if (days <= 90) return 30;
  return 10;
}

export async function computeOrganizationRelationshipScore(
  bankId: string,
  organizationId: string,
  sb: SB = supabaseAdmin(),
): Promise<RelationshipScore> {
  const now = new Date();
  const d90 = new Date(now.getTime() - 90 * 24 * 3600 * 1000).toISOString();
  const d180 = new Date(now.getTime() - 180 * 24 * 3600 * 1000).toISOString();
  const d365 = new Date(now.getTime() - 365 * 24 * 3600 * 1000).toISOString();
  const priorWindowStart = new Date(now.getTime() - 180 * 24 * 3600 * 1000).toISOString();

  const { data: activities } = await sb
    .from("crm_activities")
    .select("happens_at, direction")
    .eq("bank_id", bankId)
    .eq("target_organization_id", organizationId);
  const acts = (activities ?? []) as Array<{ happens_at: string; direction: string | null }>;

  const lastContact = acts
    .map((a) => a.happens_at)
    .filter(Boolean)
    .sort()
    .pop();
  const daysSinceLastContact = lastContact ? daysBetween(now, new Date(lastContact)) : null;

  const acts90 = acts.filter((a) => a.happens_at >= d90);
  const acts180 = acts.filter((a) => a.happens_at >= d180);
  const inbound180 = acts180.filter((a) => a.direction === "inbound").length;
  const responsiveness = acts180.length > 0 ? inbound180 / acts180.length : null;

  const { data: leadsAllTime } = await sb
    .from("brokerage_leads")
    .select("id, status, created_at, converted_at, loan_amount_requested")
    .eq("bank_id", bankId)
    .eq("referral_source_org_id", organizationId);
  const leads = (leadsAllTime ?? []) as Array<{
    id: string;
    status: string | null;
    created_at: string;
    converted_at: string | null;
    loan_amount_requested: number | null;
  }>;
  const leads12mo = leads.filter((l) => l.created_at >= d365);
  const referralVolume12mo = leads12mo.length;

  const priorLeads12mo = leads.filter((l) => l.created_at >= priorWindowStart && l.created_at < d180).length;
  const recentLeads6mo = leads.filter((l) => l.created_at >= d180).length;
  let referralTrend: RelationshipScoreComponents["referralTrend"] = "no_data";
  if (leads.length > 0) {
    if (priorLeads12mo === 0 && recentLeads6mo === 0) referralTrend = "no_data";
    else if (recentLeads6mo > priorLeads12mo) referralTrend = "increasing";
    else if (recentLeads6mo < priorLeads12mo) referralTrend = "declining";
    else referralTrend = "stable";
  }

  const disqualifyingStatuses = new Set(["new", "unresponsive"]);
  const qualifiedCount = leads.filter((l) => l.status && !disqualifyingStatuses.has(l.status)).length;
  const qualifiedReferralRate = leads.length > 0 ? qualifiedCount / leads.length : null;
  const convertedCount = leads.filter((l) => l.converted_at != null).length;
  const conversionRate = leads.length > 0 ? convertedCount / leads.length : null;

  const { data: dealsReferred } = await sb
    .from("deals")
    .select("id, loan_amount, brokerage_stage")
    .eq("bank_id", bankId)
    .eq("referral_source_org_id", organizationId);
  const deals = (dealsReferred ?? []) as Array<{ id: string; loan_amount: number | null; brokerage_stage: string | null }>;
  const TERMINAL = new Set(["post_close", "withdrawn", "declined", "lost"]);
  const fundedVolumeCents = deals
    .filter((d) => d.brokerage_stage === "funded" || d.brokerage_stage === "post_close")
    .reduce((sum, d) => sum + Math.round((d.loan_amount ?? 0) * 100), 0);
  const activePipelineCount = deals.filter((d) => d.brokerage_stage && !TERMINAL.has(d.brokerage_stage)).length;

  const dealIds = deals.map((d) => d.id);
  let revenueGeneratedCents = 0;
  if (dealIds.length > 0) {
    const { data: fees } = await sb
      .from("brokerage_fee_ledger")
      .select("deal_id, amount_cents, status")
      .in("deal_id", dealIds);
    revenueGeneratedCents = ((fees ?? []) as Array<{ amount_cents: number | null; status: string | null }>)
      .filter((f) => f.status === "earned" || f.status === "funded")
      .reduce((sum, f) => sum + (f.amount_cents ?? 0), 0);
  }

  const { data: allOrgDeals } = await sb
    .from("deals")
    .select("loan_amount, referral_source_org_id, created_at")
    .eq("bank_id", bankId)
    .not("referral_source_org_id", "is", null);
  const bankWideReferred = ((allOrgDeals ?? []) as Array<{ loan_amount: number | null; referral_source_org_id: string | null; created_at: string }>).filter(
    (d) => d.created_at >= d365,
  );
  const bankWideTotalCents = bankWideReferred.reduce((sum, d) => sum + Math.round((d.loan_amount ?? 0) * 100), 0);
  const thisOrgTotalCents = bankWideReferred
    .filter((d) => d.referral_source_org_id === organizationId)
    .reduce((sum, d) => sum + Math.round((d.loan_amount ?? 0) * 100), 0);
  const concentrationRiskPct = bankWideTotalCents > 0 ? thisOrgTotalCents / bankWideTotalCents : null;

  const { data: openFollowUps } = await sb
    .from("crm_activities")
    .select("id")
    .eq("bank_id", bankId)
    .eq("target_organization_id", organizationId)
    .eq("follow_up_required", true)
    .is("completed_at", null);
  const outstandingCommitments = (openFollowUps ?? []).length;

  const components: RelationshipScoreComponents = {
    recencyScore: recencyToScore(daysSinceLastContact),
    daysSinceLastContact,
    engagementScore: Math.min(100, acts90.length * 10),
    activityCount90d: acts90.length,
    referralVolume12mo,
    qualifiedReferralRate,
    conversionRate,
    fundedVolumeCents,
    revenueGeneratedCents,
    responsiveness,
    activePipelineCount,
    referralTrend,
    concentrationRiskPct,
    outstandingCommitments,
  };

  const referralVolumeScore = Math.min(100, referralVolume12mo * 15);
  const qualifiedRateScore = (qualifiedReferralRate ?? 0) * 100;
  const conversionScore = (conversionRate ?? 0) * 100;
  const responsivenessScore = (responsiveness ?? 0) * 100;
  const concentrationScore = concentrationRiskPct == null ? 50 : Math.max(0, 100 - concentrationRiskPct * 100);
  const commitmentsScore = Math.max(0, 100 - outstandingCommitments * 20);

  const overallScore = Math.round(
    components.recencyScore * WEIGHTS.recency +
      components.engagementScore * WEIGHTS.engagement +
      referralVolumeScore * WEIGHTS.referralVolume +
      qualifiedRateScore * WEIGHTS.qualifiedReferralRate +
      conversionScore * WEIGHTS.conversionRate +
      responsivenessScore * WEIGHTS.responsiveness +
      concentrationScore * WEIGHTS.concentration +
      commitmentsScore * WEIGHTS.outstandingCommitments,
  );

  return { organizationId, components, overallScore, weights: WEIGHTS };
}
