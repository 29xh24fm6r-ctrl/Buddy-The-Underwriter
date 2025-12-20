// src/lib/dashboard/analytics.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import { scoreDealRulesV1, type DealLike } from "@/lib/dashboard/rules";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfQuarter(d: Date) {
  const q = Math.floor(d.getMonth() / 3) * 3;
  return new Date(d.getFullYear(), q, 1);
}
function startOfYear(d: Date) {
  return new Date(d.getFullYear(), 0, 1);
}

export function defaultRanges(now = new Date()) {
  const mtd = { startDate: isoDate(startOfMonth(now)), endDate: isoDate(now) };
  const qtd = { startDate: isoDate(startOfQuarter(now)), endDate: isoDate(now) };
  const ytd = { startDate: isoDate(startOfYear(now)), endDate: isoDate(now) };
  const last30 = { startDate: isoDate(new Date(now.getTime() - 30 * 24 * 3600 * 1000)), endDate: isoDate(now) };
  return { mtd, qtd, ytd, last30 };
}

type DealRow = any;

function safeNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export async function fetchDealsForDashboard(filters: {
  userId?: string;
  stage?: string;
  dealType?: string;
}) {
  const sb = supabaseAdmin();

  // IMPORTANT:
  // Cursor: adjust select fields to match your actual deals table.
  // We assume a table named "deals" exists with common columns.
  let q = sb
    .from("deals")
    .select(
      "id, amount, stage, deal_type, created_at, anticipated_close_date, closed_at, assigned_to_user_id, last_activity_at, missing_docs_count, underwriter_assigned"
    );

  if (filters.userId) q = q.eq("assigned_to_user_id", filters.userId);
  if (filters.stage) q = q.eq("stage", filters.stage);
  if (filters.dealType) q = q.eq("deal_type", filters.dealType);

  const res = await q.limit(2000);
  if (res.error) throw res.error;

  const deals: DealLike[] = (res.data || []).map((r: DealRow) => ({
    id: r.id,
    amount: safeNum(r.amount),
    stage: r.stage || "Unknown",
    deal_type: r.deal_type ?? null,
    created_at: r.created_at ?? null,
    anticipated_close_date: r.anticipated_close_date ?? null,
    closed_at: r.closed_at ?? null,
    assigned_to_user_id: r.assigned_to_user_id ?? null,
    last_activity_at: r.last_activity_at ?? null,
    missing_docs_count: r.missing_docs_count ?? null,
    underwriter_assigned: r.underwriter_assigned ?? null,
  }));

  return deals;
}

export function computePipelineKpis(deals: DealLike[]) {
  const open = deals.filter((d) => !String(d.stage || "").toLowerCase().includes("closed") && !String(d.stage || "").toLowerCase().includes("declined"));
  const closed = deals.filter((d) => String(d.stage || "").toLowerCase().includes("closed"));

  const totalPipeline = open.reduce((s, d) => s + d.amount, 0);

  // Weighted = sum(amount * prob)
  const scored = open.map((d) => {
    const s = scoreDealRulesV1(d);
    return { ...d, probability: s.probability, eta_close_date: s.eta_close_date, risk_flags: s.risk_flags, reasons: s.reasons };
  });

  const weightedPipeline = scored.reduce((s, d: any) => s + d.amount * (d.probability / 100), 0);

  const byStage: Record<string, { count: number; amount: number }> = {};
  for (const d of open) {
    const k = d.stage || "Unknown";
    byStage[k] = byStage[k] || { count: 0, amount: 0 };
    byStage[k].count += 1;
    byStage[k].amount += d.amount;
  }

  const byType: Record<string, { count: number; amount: number }> = {};
  for (const d of open) {
    const k = d.deal_type || "Unknown";
    byType[k] = byType[k] || { count: 0, amount: 0 };
    byType[k].count += 1;
    byType[k].amount += d.amount;
  }

  // Anticipated closings buckets by ETA
  const now = new Date();
  function daysOut(dateStr: string) {
    const dt = new Date(dateStr + "T00:00:00Z");
    return Math.floor((dt.getTime() - now.getTime()) / (24 * 3600 * 1000));
  }

  const buckets = { next7: 0, next14: 0, next30: 0, next90: 0 };
  for (const d of scored as any[]) {
    const eta = d.eta_close_date;
    if (!eta) continue;
    const dd = daysOut(eta);
    if (dd <= 7) buckets.next7 += 1;
    if (dd <= 14) buckets.next14 += 1;
    if (dd <= 30) buckets.next30 += 1;
    if (dd <= 90) buckets.next90 += 1;
  }

  // Bottlenecks: missing docs, stale, no UW
  const bottlenecks = scored
    .map((d: any) => ({
      id: d.id,
      stage: d.stage,
      amount: d.amount,
      probability: d.probability,
      eta_close_date: d.eta_close_date,
      flags: d.risk_flags,
    }))
    .filter((x) => (x.flags || []).length > 0)
    .slice(0, 30);

  // Next Best Actions (deterministic)
  const nextBestActions = bottlenecks.map((b) => {
    const flags = b.flags || [];
    const top = flags[0];
    let action = "Review deal";
    if (top?.kind === "missing_docs") action = "Request missing documents";
    if (top?.kind === "stale") action = "Follow up (deal stale)";
    if (top?.kind === "no_uw") action = "Assign underwriter";
    return { dealId: b.id, action, evidence: flags };
  });

  return {
    totals: {
      openCount: open.length,
      closedCount: closed.length,
      totalPipeline,
      weightedPipeline,
    },
    byStage,
    byType,
    closingsBuckets: buckets,
    scoredOpenDeals: scored.slice(0, 500),
    bottlenecks,
    nextBestActions,
  };
}
