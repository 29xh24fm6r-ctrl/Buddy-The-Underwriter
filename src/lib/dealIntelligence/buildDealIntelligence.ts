import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import type { DealIntelligence } from "@/lib/dealIntelligence/types";
import { resolveDealLabel } from "@/lib/deals/dealLabel";

const RECENT_DOC_LIMIT = 8;
const ACTIVITY_LIMIT = 10;

function safeString(value: unknown, fallback = "Unknown / Not provided") {
  const s = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return s ? s : fallback;
}

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "Unknown / Not provided";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function categorizeChecklistKey(key: string) {
  const upper = key.toUpperCase();
  if (
    upper.includes("TAX") ||
    upper.includes("FIN") ||
    upper.includes("PFS") ||
    upper.includes("BANK") ||
    upper.includes("STATEMENT")
  ) {
    return "financials" as const;
  }
  if (
    upper.includes("SBA") ||
    upper.includes("LICENSE") ||
    upper.includes("ENTITY") ||
    upper.includes("OPERATING") ||
    upper.includes("ORGANIZATION")
  ) {
    return "legal" as const;
  }
  if (
    upper.includes("COLLATERAL") ||
    upper.includes("APPRAISAL") ||
    upper.includes("LEASE") ||
    upper.includes("REAL_ESTATE")
  ) {
    return "collateral" as const;
  }
  return "documents" as const;
}

function computeReadiness(args: {
  requiredTotal: number;
  receivedCount: number;
  openConditions: number;
  checklistItems: Array<{ key: string; required: boolean; received: boolean }>;
  activityCount48h: number;
  assumptions: string[];
}) {
  const {
    requiredTotal,
    receivedCount,
    openConditions,
    checklistItems,
    activityCount48h,
    assumptions,
  } = args;

  if (requiredTotal === 0) {
    assumptions.push("Checklist is not seeded; document readiness inferred as unknown.");
  }

  const documentsScore = requiredTotal > 0 ? Math.round((receivedCount / requiredTotal) * 60) : 0;
  const conditionsPenalty = Math.min(openConditions * 4, 20);
  const activityBoost = activityCount48h > 0 ? 10 : 0;
  const rawScore = Math.max(0, Math.min(100, documentsScore - conditionsPenalty + activityBoost));

  const label: DealIntelligence["readiness"]["label"] =
    rawScore >= 80 ? "Submission Ready" : rawScore >= 50 ? "Near Ready" : "Not Ready";

  const categoryTotals = {
    documents: { required: 0, received: 0 },
    financials: { required: 0, received: 0 },
    legal: { required: 0, received: 0 },
    collateral: { required: 0, received: 0 },
  };

  checklistItems.forEach((item) => {
    const bucket = categorizeChecklistKey(item.key);
    if (item.required) {
      categoryTotals[bucket].required += 1;
      if (item.received) categoryTotals[bucket].received += 1;
    }
  });

  const breakdown = {
    documents: categoryTotals.documents.required
      ? Math.round((categoryTotals.documents.received / categoryTotals.documents.required) * 100)
      : 0,
    financials: categoryTotals.financials.required
      ? Math.round((categoryTotals.financials.received / categoryTotals.financials.required) * 100)
      : 0,
    legal: categoryTotals.legal.required
      ? Math.round((categoryTotals.legal.received / categoryTotals.legal.required) * 100)
      : 0,
    collateral: categoryTotals.collateral.required
      ? Math.round((categoryTotals.collateral.received / categoryTotals.collateral.required) * 100)
      : 0,
  };

  if (categoryTotals.financials.required === 0) {
    assumptions.push("Financial checklist coverage not available; financial readiness set to 0%.");
  }
  if (categoryTotals.legal.required === 0) {
    assumptions.push("Legal checklist coverage not available; legal readiness set to 0%.");
  }
  if (categoryTotals.collateral.required === 0) {
    assumptions.push("Collateral checklist coverage not available; collateral readiness set to 0%.");
  }

  const explainability: string[] = [];
  if (requiredTotal > 0) {
    explainability.push(`${receivedCount} of ${requiredTotal} required checklist items received.`);
  } else {
    explainability.push("Checklist items not available; readiness weighted conservatively.");
  }
  if (openConditions > 0) {
    explainability.push(`${openConditions} open condition(s) reduce readiness.`);
  } else {
    explainability.push("No open conditions detected in current data.");
  }
  if (activityCount48h > 0) {
    explainability.push("Recent activity detected in the last 48 hours adds momentum.");
  } else {
    explainability.push("No recent activity in the last 48 hours.");
  }

  return { score0to100: rawScore, label, breakdown, explainability };
}

export async function buildDealIntelligence(
  dealId: string,
  opts?: { bankId?: string }
): Promise<DealIntelligence> {
  const assumptions: string[] = [];
  const sb = supabaseAdmin();

  let bankId = opts?.bankId ?? null;
  if (!bankId) {
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      throw new Error(`deal_access_${access.error}`);
    }
    bankId = access.bankId;
  }

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select(
      "id, borrower_name, name, display_name, nickname, stage, risk_score, created_at, updated_at, amount, bank_id"
    )
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) {
    throw new Error("deal_not_found");
  }

  if (bankId && deal.bank_id && String(deal.bank_id) !== String(bankId)) {
    throw new Error("tenant_mismatch");
  }

  const labelResult = resolveDealLabel({
    id: deal.id,
    display_name: (deal as any).display_name ?? null,
    nickname: (deal as any).nickname ?? null,
    borrower_name: deal.borrower_name ?? null,
    name: deal.name ?? null,
  });

  const checklistPromise = sb
    .from("deal_checklist_items")
    .select("checklist_key, required, received_at")
    .eq("deal_id", dealId);

  const documentsPromise = sb
    .from("deal_documents")
    .select("id, original_filename, created_at, mime_type, status, checklist_key")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(RECENT_DOC_LIMIT);

  const documentsCountPromise = sb
    .from("deal_documents")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  const ledgerPromise = sb
    .from("deal_pipeline_ledger")
    .select("event_key, ui_message, stage, status, created_at")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .limit(ACTIVITY_LIMIT);

  const conditionsPromise = sb
    .from("deal_conditions")
    .select("id, title, status, created_at, updated_at")
    .eq("deal_id", dealId);

  const [checklistRes, documentsRes, documentsCountRes, ledgerRes, conditionsRes] = await Promise.all([
    checklistPromise,
    documentsPromise,
    documentsCountPromise,
    ledgerPromise,
    conditionsPromise,
  ]);

  const checklistItems = (checklistRes.data ?? []).map((item: any) => ({
    key: String(item.checklist_key ?? "UNKNOWN"),
    required: Boolean(item.required),
    received: Boolean(item.received_at),
  }));

  const requiredItems = checklistItems.filter((item) => item.required);
  const receivedItems = requiredItems.filter((item) => item.received);
  const missingItems = requiredItems.filter((item) => !item.received);
  const optionalMissing = checklistItems.filter((item) => !item.required && !item.received);

  const missingKeys = missingItems.map((item) => item.key);
  const receivedKeys = receivedItems.map((item) => item.key);

  const documentsRecent = (documentsRes.data ?? []).map((doc: any) => ({
    id: String(doc.id),
    label: safeString(doc.checklist_key || doc.original_filename || "Document"),
    original_filename: safeString(doc.original_filename || "Document"),
    received_at: doc.created_at ? String(doc.created_at) : null,
    mime_type: doc.mime_type ? String(doc.mime_type) : null,
    status: doc.status ? String(doc.status) : null,
  }));

  const activity = (ledgerRes.data ?? []).map((row: any) => ({
    at: row.created_at ? String(row.created_at) : null,
    kind: String(row.event_key ?? row.stage ?? "event"),
    label: safeString(row.ui_message ?? row.event_key ?? "Activity"),
    detail: row.status ? String(row.status) : null,
  }));

  const openConditions = (conditionsRes.data ?? []).filter((row: any) => {
    const status = String(row.status ?? "").toLowerCase();
    return status === "pending" || status === "in_progress" || status === "open";
  });

  const nowMs = Date.now();
  const activityCount48h = activity.filter((item) => {
    if (!item.at) return false;
    const ts = new Date(item.at).getTime();
    return Number.isFinite(ts) && nowMs - ts <= 48 * 60 * 60 * 1000;
  }).length;

  if (deal.risk_score == null) {
    assumptions.push("Risk score is not available; risk factors are conservative.");
  }

  const readiness = computeReadiness({
    requiredTotal: requiredItems.length,
    receivedCount: receivedItems.length,
    openConditions: openConditions.length,
    checklistItems,
    activityCount48h,
    assumptions,
  });

  const borrowerName = safeString(deal.borrower_name ?? deal.name);
  const stage = safeString(deal.stage ?? "Unknown");

  const memoAssumptions = [...assumptions];
  if (!deal.amount) {
    memoAssumptions.push("Loan amount not provided; loan request section is generalized.");
  }

  const memoDraft = {
    title: "AI Draft — v1",
    generatedAt: new Date().toISOString(),
    executiveSummary: `Current stage: ${stage}. Readiness score ${readiness.score0to100}/100 (${readiness.label}).`,
    borrowerOverview: `Borrower: ${borrowerName}. Known stage: ${stage}.`,
    loanRequest: `Requested loan amount: ${formatCurrency(deal.amount ?? null)}. Purpose: Unknown / Not provided.`,
    collateralSummary: "Collateral details not provided; verify collateral package.",
    documentChecklistStatus: `Required checklist items received: ${receivedItems.length} / ${requiredItems.length}.`,
    riskFactors: deal.risk_score != null && deal.risk_score >= 70
      ? ["Elevated risk score requires additional mitigants."]
      : ["Risk score is within acceptable range or unavailable; validate underwriting inputs."],
    openItems: [
      `${missingItems.length} required checklist item(s) missing.`,
      `${openConditions.length} open condition(s) outstanding.`,
    ],
    recentActivity: activity.slice(0, 5).map((item) => `${item.label}${item.at ? ` (${item.at})` : ""}`),
    assumptions: memoAssumptions,
  };

  return {
    deal: {
      id: String(deal.id),
      display_name: (deal as any).display_name ?? null,
      nickname: (deal as any).nickname ?? null,
      display_label: labelResult.label,
      display_label_source: labelResult.source,
      needs_name: labelResult.needsName,
      borrower_name: borrowerName,
      stage,
      risk_score: deal.risk_score ?? null,
      created_at: deal.created_at ? String(deal.created_at) : null,
      updated_at: deal.updated_at ? String(deal.updated_at) : null,
      loan_amount: deal.amount ?? null,
    },
    checklist: {
      requiredTotal: requiredItems.length,
      receivedCount: receivedItems.length,
      pendingCount: missingItems.length,
      missingKeys,
      receivedKeys,
      optionalMissingKeys: optionalMissing.map((item) => item.key),
    },
    documents: {
      total: documentsCountRes.count ?? documentsRecent.length,
      recent: documentsRecent,
    },
    activity,
    readiness,
    conditions: {
      open: openConditions.map((row: any) => ({
        key: String(row.id ?? row.title ?? "condition"),
        label: safeString(row.title ?? "Condition"),
        status: String(row.status ?? "unknown"),
        requested_at: row.created_at ? String(row.created_at) : null,
      })),
      missingDocs: [
        ...missingItems.map((item) => ({
          key: item.key,
          label: item.key,
          required: true,
        })),
        ...optionalMissing.map((item) => ({
          key: item.key,
          label: item.key,
          required: false,
        })),
      ],
    },
    memoDraft,
    assumptions,
  };
}

export function formatCreditMemoMarkdown(intel: DealIntelligence) {
  const memo = intel.memoDraft;
  const lines = [
    `# Credit Memo Draft (AI v1)` ,
    `Deal Name: ${intel.deal.display_label}`,
    `Deal ID: ${intel.deal.id}`,
    `Borrower: ${intel.deal.borrower_name}`,
    `Stage: ${intel.deal.stage}`,
    `Generated: ${memo.generatedAt}`,
    "",
    "## Executive Summary",
    memo.executiveSummary,
    "",
    "## Borrower Overview",
    memo.borrowerOverview,
    "",
    "## Loan Request",
    memo.loanRequest,
    "",
    "## Collateral Summary",
    memo.collateralSummary,
    "",
    "## Document / Checklist Status",
    memo.documentChecklistStatus,
    "",
    "## Risk Factors",
    ...(memo.riskFactors.length ? memo.riskFactors.map((r) => `- ${r}`) : ["- None identified"]),
    "",
    "## Open Items / Conditions",
    ...(memo.openItems.length ? memo.openItems.map((o) => `- ${o}`) : ["- None"]),
    "",
    "## Recent Activity",
    ...(memo.recentActivity.length ? memo.recentActivity.map((a) => `- ${a}`) : ["- None"]),
  ];

  if (memo.assumptions.length) {
    lines.push("", "## Assumptions / Missing Data", ...memo.assumptions.map((a) => `- ${a}`));
  }

  return lines.join("\n");
}

export function formatConditionsEmail(intel: DealIntelligence) {
  const requiredMissing = intel.conditions.missingDocs.filter((d) => d.required);
  const optionalMissing = intel.conditions.missingDocs.filter((d) => !d.required);

  const lines = [
    `Deal ${intel.deal.display_label} (${intel.deal.id}) — Conditions & Missing Docs`,
    `Borrower: ${intel.deal.borrower_name}`,
    `Stage: ${intel.deal.stage}`,
    "",
    `Required missing documents (${requiredMissing.length}):`,
    ...(requiredMissing.length ? requiredMissing.map((d) => `- ${d.label}`) : ["- None"]),
    "",
    `Optional missing documents (${optionalMissing.length}):`,
    ...(optionalMissing.length ? optionalMissing.map((d) => `- ${d.label}`) : ["- None"]),
    "",
    `Open conditions (${intel.conditions.open.length}):`,
    ...(intel.conditions.open.length
      ? intel.conditions.open.map((c) => `- ${c.label} (${c.status})`)
      : ["- None"]),
  ];

  if (intel.assumptions.length) {
    lines.push("", "Assumptions / Missing Data:", ...intel.assumptions.map((a) => `- ${a}`));
  }

  return lines.join("\n");
}
