import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listLeadQueue } from "@/lib/leads/queries";
import { listManagementQueue } from "@/lib/dealStage/queues";
import { computeIntelligenceAlerts } from "@/lib/intelligence/alerts";
import { computePipelineForecast } from "@/lib/intelligence/forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brokerage/command-center
 *
 * Spec section 7.6 — the brokerage operational command center. Every
 * panel is a thin wrapper around a queue/finder already built in PR2-PR5
 * (listLeadQueue, listManagementQueue, computeIntelligenceAlerts,
 * computePipelineForecast) plus two small computations (referral-relationship
 * health, recent wins/losses) that reuse the same source tables those PRs
 * already established as authoritative. This is deliberately a SEPARATE
 * surface from BrokerageOwnerCommandCenter (src/components/admin/) —
 * that component's own test suite asserts it never renders forecast/
 * revenue language, since it's scoped to non-predictive operational
 * visibility; this command center is explicitly meant to forecast.
 */

function healthBucket(lastActivityAt: string | null): "active" | "cooling" | "cold" | "new" {
  if (!lastActivityAt) return "new";
  const days = (Date.now() - new Date(lastActivityAt).getTime()) / (24 * 3600 * 1000);
  if (days <= 30) return "active";
  if (days <= 60) return "cooling";
  return "cold";
}

export async function GET(req: NextRequest) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const scope = req.nextUrl.searchParams.get("scope") ?? "team";

  const [
    newLeadsNeedingContact,
    overdueLeadFollowUps,
    qualifiedLeadsAwaitingConversion,
    stalledDeals,
    missingDocuments,
    outstandingConditions,
    readyForLenderStrategy,
    submittedAwaitingResponse,
    closingsApproaching,
    fundedAwaitingPayment,
    alerts,
    forecast,
  ] = await Promise.all([
    listLeadQueue({ bankId, queue: "no_contact_attempted" }, sb),
    listLeadQueue({ bankId, queue: "overdue_follow_up" }, sb),
    listLeadQueue({ bankId, queue: "qualified_not_converted" }, sb),
    listManagementQueue({ bankId, queue: "stalled_deals" }, sb),
    listManagementQueue({ bankId, queue: "missing_documents" }, sb),
    listManagementQueue({ bankId, queue: "outstanding_conditions" }, sb),
    listManagementQueue({ bankId, queue: "ready_for_lender_strategy" }, sb),
    listManagementQueue({ bankId, queue: "submitted_no_lender_response" }, sb),
    listManagementQueue({ bankId, queue: "closing_next_30_days" }, sb),
    listManagementQueue({ bankId, queue: "funded_awaiting_payment" }, sb),
    computeIntelligenceAlerts(bankId, null, sb),
    computePipelineForecast(bankId, sb),
  ]);

  const dealsWithBlockersIds = new Set<string>(
    [...missingDocuments.map((d: any) => d.deal_id), ...outstandingConditions.map((d: any) => d.deal_id)].filter(
      (id): id is string => Boolean(id),
    ),
  );

  const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const { data: orgs } = await sb.from("crm_organizations").select("id, name").eq("bank_id", bankId).eq("organization_type", "referral_source");
  const { data: recentActivities } = await sb
    .from("crm_activities")
    .select("target_organization_id, happens_at")
    .eq("bank_id", bankId)
    .not("target_organization_id", "is", null)
    .order("happens_at", { ascending: false });
  const lastActivityByOrg = new Map<string, string>();
  for (const a of (recentActivities ?? []) as Array<{ target_organization_id: string; happens_at: string }>) {
    if (!lastActivityByOrg.has(a.target_organization_id)) lastActivityByOrg.set(a.target_organization_id, a.happens_at);
  }
  const referralRelationshipsNeedingAttention = ((orgs ?? []) as Array<{ id: string; name: string }>)
    .map((o) => ({ id: o.id, name: o.name, lastActivityAt: lastActivityByOrg.get(o.id) ?? null, health: healthBucket(lastActivityByOrg.get(o.id) ?? null) }))
    .filter((o) => o.health === "cooling" || o.health === "cold");

  const { data: recentlyConvertedLeads } = await sb.from("brokerage_leads").select("id, business_name, converted_at").eq("bank_id", bankId).gte("converted_at", d30);
  const { data: recentTransitionsToFunded } = await sb.from("deal_brokerage_stage_transitions").select("deal_id, created_at").eq("bank_id", bankId).eq("to_stage", "funded").gte("created_at", d30);
  const recentWins = {
    leadsConverted: recentlyConvertedLeads ?? [],
    dealsFunded: recentTransitionsToFunded ?? [],
  };

  const { data: recentlyLostLeads } = await sb
    .from("brokerage_leads")
    .select("id, business_name, status, lost_reason, disqualification_reason, updated_at")
    .eq("bank_id", bankId)
    .in("status", ["lost", "disqualified", "withdrawn", "unresponsive"])
    .gte("updated_at", d30);
  const { data: recentTransitionsToLost } = await sb
    .from("deal_brokerage_stage_transitions")
    .select("deal_id, to_stage, reason, created_at")
    .eq("bank_id", bankId)
    .in("to_stage", ["declined", "lost", "withdrawn"])
    .gte("created_at", d30);
  const recentLosses = {
    leadsLost: recentlyLostLeads ?? [],
    dealsLost: recentTransitionsToLost ?? [],
  };

  const { data: activeDeals } = await sb.from("deals").select("id").eq("bank_id", bankId).not("brokerage_stage", "in", '("post_close","withdrawn","declined","lost")');
  const { data: brokerParticipants } = await sb
    .from("deal_participants")
    .select("deal_id, clerk_user_id")
    .eq("role", "broker")
    .eq("is_active", true)
    .in("deal_id", (activeDeals ?? []).map((d: any) => d.id).length > 0 ? (activeDeals ?? []).map((d: any) => d.id) : ["__none__"]);
  const workloadCounts = new Map<string, number>();
  for (const p of (brokerParticipants ?? []) as Array<{ clerk_user_id: string }>) {
    workloadCounts.set(p.clerk_user_id, (workloadCounts.get(p.clerk_user_id) ?? 0) + 1);
  }
  const teamWorkload = Array.from(workloadCounts.entries()).map(([clerkUserId, activeDealCount]) => ({ clerkUserId, activeDealCount })).sort((a, b) => b.activeDealCount - a.activeDealCount);

  return NextResponse.json({
    ok: true,
    scope,
    panels: {
      newLeadsNeedingContact,
      overdueLeadFollowUps,
      qualifiedLeadsAwaitingConversion,
      dealsWithBlockers: Array.from(dealsWithBlockersIds),
      stalledDeals,
      missingDocuments,
      readyForLenderStrategy,
      submittedAwaitingResponse,
      outstandingConditions,
      closingsApproaching,
      fundedAwaitingPayment,
      referralRelationshipsNeedingAttention,
      teamWorkload,
      recentWins,
      recentLosses,
      criticalAlerts: alerts,
    },
    pipelineForecast: {
      bestCaseLoanVolumeCents: forecast.bestCaseLoanVolumeCents,
      expectedLoanVolumeCents: forecast.expectedLoanVolumeCents,
      committedLoanVolumeCents: forecast.committedLoanVolumeCents,
      byMonth: forecast.byMonth,
    },
    revenueForecast: {
      expectedGrossRevenueCents: forecast.expectedGrossRevenueCents,
      byOwner: forecast.byOwner,
      bySource: forecast.bySource,
      byLoanType: forecast.byLoanType,
      assumptions: forecast.assumptions,
    },
  });
}
