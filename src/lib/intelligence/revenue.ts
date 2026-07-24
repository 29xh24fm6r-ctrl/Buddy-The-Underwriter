import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getRevenueSummary, runRevenueReconciliation } from "@/lib/brokerage/revenueOps";
import type { SB } from "./types";

/**
 * Revenue aggregation — spec section 7.4. Reads brokerage_fee_ledger /
 * brokerage_revenue_events (BRK-10I, already the authoritative fee
 * accrual pipeline) and brokerage_commission_splits (new in this PR) —
 * it does not recompute fee amounts itself, only groups/sums what
 * revenueOps.ts already tracks. lender_invoices remains the authoritative
 * record of what was actually billed to and collected from a lender;
 * getInvoiceCollectionStatus below is how a revenue view answers "has
 * this been billed and paid" without re-implementing invoicing.
 *
 * Loan amount is never returned under a revenue field name anywhere in
 * this file -- see the dedicated guard test
 * (src/lib/intelligence/__tests__/revenue.test.ts) asserting on this.
 */

export type RevenueByGroup = { key: string; label: string; grossRevenueCents: number; netRevenueCents: number; dealCount: number };

export type RevenueRollup = {
  bySource: RevenueByGroup[];
  byBroker: RevenueByGroup[];
  byLender: RevenueByGroup[];
  byLoanType: RevenueByGroup[];
  totalGrossRevenueCents: number;
  totalNetRevenueCents: number;
  totalFundedDeals: number;
};

type FundedDealRow = { id: string; referral_source_org_id: string | null; brokerage_stage: string | null };

async function fundedDeals(bankId: string, sb: SB): Promise<FundedDealRow[]> {
  const { data } = await sb.from("deals").select("id, referral_source_org_id, brokerage_stage").eq("bank_id", bankId).in("brokerage_stage", ["funded", "post_close"]);
  return (data ?? []) as FundedDealRow[];
}

async function feesByDeal(dealIds: string[], sb: SB): Promise<Map<string, { grossCents: number }>> {
  const map = new Map<string, { grossCents: number }>();
  if (dealIds.length === 0) return map;
  const { data } = await sb.from("brokerage_fee_ledger").select("deal_id, amount_cents, status").in("deal_id", dealIds);
  for (const row of (data ?? []) as Array<{ deal_id: string; amount_cents: number | null; status: string | null }>) {
    if (row.status !== "earned" && row.status !== "funded") continue;
    const cur = map.get(row.deal_id) ?? { grossCents: 0 };
    cur.grossCents += row.amount_cents ?? 0;
    map.set(row.deal_id, cur);
  }
  return map;
}

async function splitsByDeal(dealIds: string[], sb: SB): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (dealIds.length === 0) return map;
  const { data } = await sb.from("brokerage_commission_splits").select("deal_id, amount_cents").in("deal_id", dealIds);
  for (const row of (data ?? []) as Array<{ deal_id: string; amount_cents: number | null }>) {
    map.set(row.deal_id, (map.get(row.deal_id) ?? 0) + (row.amount_cents ?? 0));
  }
  return map;
}

function rollupBy(deals: FundedDealRow[], gross: Map<string, { grossCents: number }>, net: Map<string, number>, keyFn: (d: FundedDealRow) => { key: string; label: string }): RevenueByGroup[] {
  const groups = new Map<string, RevenueByGroup>();
  for (const d of deals) {
    const { key, label } = keyFn(d);
    const g = groups.get(key) ?? { key, label, grossRevenueCents: 0, netRevenueCents: 0, dealCount: 0 };
    const grossCents = gross.get(d.id)?.grossCents ?? 0;
    const paidOutCents = net.get(d.id) ?? 0;
    g.grossRevenueCents += grossCents;
    g.netRevenueCents += grossCents - paidOutCents;
    g.dealCount += 1;
    groups.set(key, g);
  }
  return Array.from(groups.values()).sort((a, b) => b.grossRevenueCents - a.grossRevenueCents);
}

export async function computeRevenueRollup(bankId: string, sb: SB = supabaseAdmin()): Promise<RevenueRollup> {
  const deals = await fundedDeals(bankId, sb);
  const dealIds = deals.map((d) => d.id);
  const [gross, net] = await Promise.all([feesByDeal(dealIds, sb), splitsByDeal(dealIds, sb)]);

  const { data: orgs } = await sb.from("crm_organizations").select("id, name").in("id", Array.from(new Set(deals.map((d) => d.referral_source_org_id).filter(Boolean) as string[])).length > 0 ? Array.from(new Set(deals.map((d) => d.referral_source_org_id).filter(Boolean) as string[])) : ["__none__"]);
  const orgNameById = new Map(((orgs ?? []) as Array<{ id: string; name: string }>).map((o) => [o.id, o.name]));

  const { data: fundingVerifications } = await sb.from("brokerage_funding_verifications").select("deal_id, lender_bank_id").eq("status", "verified").in("deal_id", dealIds.length > 0 ? dealIds : ["__none__"]);
  const lenderByDeal = new Map(((fundingVerifications ?? []) as Array<{ deal_id: string; lender_bank_id: string | null }>).map((v) => [v.deal_id, v.lender_bank_id]));
  const lenderIds = Array.from(new Set(Array.from(lenderByDeal.values()).filter(Boolean) as string[]));
  const { data: lenderBanks } = await sb.from("banks").select("id, name").in("id", lenderIds.length > 0 ? lenderIds : ["__none__"]);
  const lenderNameById = new Map(((lenderBanks ?? []) as Array<{ id: string; name: string }>).map((b) => [b.id, b.name]));

  const { data: brokerageLeads } = await sb.from("brokerage_leads").select("converted_deal_id, loan_program").not("converted_deal_id", "is", null);
  const loanProgramByDeal = new Map(((brokerageLeads ?? []) as Array<{ converted_deal_id: string; loan_program: string | null }>).map((l) => [l.converted_deal_id, l.loan_program]));

  const bySource = rollupBy(deals, gross, net, (d) => ({
    key: d.referral_source_org_id ?? "unattributed",
    label: d.referral_source_org_id ? orgNameById.get(d.referral_source_org_id) ?? "Unknown organization" : "Unattributed",
  }));
  const byLender = rollupBy(deals, gross, net, (d) => {
    const lenderId = lenderByDeal.get(d.id) ?? null;
    return { key: lenderId ?? "unassigned", label: lenderId ? lenderNameById.get(lenderId) ?? "Unknown lender" : "Unassigned" };
  });
  const byLoanType = rollupBy(deals, gross, net, (d) => {
    const program = loanProgramByDeal.get(d.id) ?? null;
    return { key: program ?? "unspecified", label: program ?? "Unspecified" };
  });

  const { data: brokerParticipants } = await sb.from("deal_participants").select("deal_id, clerk_user_id").eq("role", "broker").eq("is_active", true).in("deal_id", dealIds.length > 0 ? dealIds : ["__none__"]);
  const brokerByDeal = new Map(((brokerParticipants ?? []) as Array<{ deal_id: string; clerk_user_id: string }>).map((p) => [p.deal_id, p.clerk_user_id]));
  const byBroker = rollupBy(deals, gross, net, (d) => {
    const brokerId = brokerByDeal.get(d.id) ?? null;
    return { key: brokerId ?? "unassigned", label: brokerId ?? "Unassigned" };
  });

  const totalGrossRevenueCents = bySource.reduce((sum, g) => sum + g.grossRevenueCents, 0);
  const totalNetRevenueCents = bySource.reduce((sum, g) => sum + g.netRevenueCents, 0);

  return { bySource, byBroker, byLender, byLoanType, totalGrossRevenueCents, totalNetRevenueCents, totalFundedDeals: deals.length };
}

export { getRevenueSummary, runRevenueReconciliation };

/**
 * Deals in a terminal-funded stage with no funding verification row —
 * the automated-detection half of the gap src/lib/brokerage/dailyOps.ts
 * already flags as a manual action item ("Run verifyDealFunding for
 * funded deals"). This surfaces the gap as data for the alerts engine;
 * it deliberately does NOT call verifyDealFunding automatically, since
 * that requires real evidence (verification_source/evidence_document_id)
 * a human must supply -- automating detection is safe, automating the
 * verification itself would fabricate evidence.
 */
export async function findFundedDealsMissingVerification(bankId: string, sb: SB = supabaseAdmin()): Promise<string[]> {
  const deals = await fundedDeals(bankId, sb);
  if (deals.length === 0) return [];
  const dealIds = deals.map((d) => d.id);
  const { data: verified } = await sb.from("brokerage_funding_verifications").select("deal_id").eq("status", "verified").in("deal_id", dealIds);
  const verifiedSet = new Set(((verified ?? []) as Array<{ deal_id: string }>).map((v) => v.deal_id));
  return dealIds.filter((id) => !verifiedSet.has(id));
}
