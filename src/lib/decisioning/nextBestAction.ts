/**
 * Next Best Action — Phase 66B Decision & Action Engine
 *
 * Server module. Generates next-best-action recommendations for bankers
 * and borrowers based on current deal state and identified gaps.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { rankActions, type ActionCandidate } from "./actionPriorityEngine";
import { actionRecommendationToRow } from "@/lib/contracts/phase66b66cRowMappers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionRecommendation {
  visibility: "banker" | "borrower";
  actor: string;
  category: string;
  title: string;
  description: string;
  rationale: Record<string, unknown>;
  blockedBy: Record<string, unknown>;
  expectedImpact: Record<string, unknown>;
  priorityScore: number;
  urgencyScore: number;
  confidence: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface DealState {
  id: string;
  loan_amount: number | null;
  loan_type: string | null;
  status: string | null;
  borrower_name: string | null;
}

interface DealSnapshot {
  dscr?: number;
  ltv?: number;
  debt_yield?: number;
  current_ratio?: number;
}

async function loadDealState(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<DealState | null> {
  const { data } = await sb
    .from("deals")
    .select("id, loan_amount, loan_type, status, borrower_name")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .single();
  return data as DealState | null;
}

async function loadLatestSnapshot(
  sb: SupabaseClient,
  dealId: string,
): Promise<DealSnapshot | null> {
  const { data } = await sb
    .from("deal_financial_snapshots")
    .select("dscr, ltv, debt_yield, current_ratio")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as DealSnapshot | null;
}

async function loadMissingDocTypes(
  sb: SupabaseClient,
  dealId: string,
): Promise<string[]> {
  const { data } = await sb
    .from("deal_document_slots")
    .select("doc_type")
    .eq("deal_id", dealId)
    .eq("status", "missing");
  if (!data) return [];
  return data.map((d: { doc_type: string }) => d.doc_type);
}

function confidenceFromEvidence(strength: "high" | "medium" | "low"): "high" | "medium" | "low" {
  return strength;
}

// ---------------------------------------------------------------------------
// Banker action generation
// ---------------------------------------------------------------------------

function buildBankerCandidates(
  _deal: DealState,
  snapshot: DealSnapshot | null,
  missingDocs: string[],
): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];

  // Missing documents → diligence requests
  for (const docType of missingDocs) {
    candidates.push({
      category: "diligence_request",
      metricAffected: "completeness",
      evidenceStrength: "high",
      urgency: "immediate",
      difficulty: "easy",
      impactEstimate: "high",
    });
  }

  // DSCR below threshold
  if (snapshot?.dscr != null && snapshot.dscr < 1.25) {
    const gap = 1.25 - snapshot.dscr;
    candidates.push({
      category: "structure_adjustment",
      metricAffected: "dscr",
      currentGap: gap,
      evidenceStrength: "high",
      urgency: snapshot.dscr < 1.0 ? "immediate" : "soon",
      difficulty: "moderate",
      impactEstimate: "high",
    });
  }

  // LTV above threshold
  if (snapshot?.ltv != null && snapshot.ltv > 80) {
    candidates.push({
      category: "structure_adjustment",
      metricAffected: "ltv",
      currentGap: snapshot.ltv - 80,
      evidenceStrength: "high",
      urgency: snapshot.ltv > 90 ? "immediate" : "soon",
      difficulty: "moderate",
      impactEstimate: "medium",
    });
  }

  // If snapshot is missing entirely, recommend monitoring step
  if (!snapshot) {
    candidates.push({
      category: "monitoring_step",
      metricAffected: "snapshot",
      evidenceStrength: "low",
      urgency: "soon",
      difficulty: "easy",
      impactEstimate: "medium",
    });
  }

  // Memo improvement suggestion if data is sufficient
  if (snapshot && missingDocs.length === 0) {
    candidates.push({
      category: "memo_improvement",
      evidenceStrength: "medium",
      urgency: "eventually",
      difficulty: "easy",
      impactEstimate: "medium",
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Borrower action generation
// ---------------------------------------------------------------------------

function buildBorrowerCandidates(
  _deal: DealState,
  snapshot: DealSnapshot | null,
  missingDocs: string[],
): ActionCandidate[] {
  const candidates: ActionCandidate[] = [];

  // Missing documents → document_fix
  for (const docType of missingDocs) {
    candidates.push({
      category: "document_fix",
      metricAffected: "completeness",
      evidenceStrength: "high",
      urgency: "immediate",
      difficulty: "easy",
      impactEstimate: "high",
    });
  }

  // Cash flow improvement if DSCR is weak
  if (snapshot?.dscr != null && snapshot.dscr < 1.25) {
    candidates.push({
      category: "cash_improvement",
      metricAffected: "dscr",
      currentGap: 1.25 - snapshot.dscr,
      evidenceStrength: "medium",
      urgency: "soon",
      difficulty: "moderate",
      impactEstimate: "high",
    });
  }

  // Capital structure opportunity if LTV is high
  if (snapshot?.ltv != null && snapshot.ltv > 75) {
    candidates.push({
      category: "capital_structure",
      metricAffected: "ltv",
      currentGap: snapshot.ltv - 75,
      evidenceStrength: "medium",
      urgency: "soon",
      difficulty: "hard",
      impactEstimate: "medium",
    });
  }

  // Lender readiness if no snapshot
  if (!snapshot) {
    candidates.push({
      category: "lender_readiness",
      evidenceStrength: "low",
      urgency: "soon",
      difficulty: "moderate",
      impactEstimate: "medium",
    });
  }

  // Operational fix for weak current ratio
  if (snapshot?.current_ratio != null && snapshot.current_ratio < 1.0) {
    candidates.push({
      category: "operational_fix",
      metricAffected: "current_ratio",
      currentGap: 1.0 - snapshot.current_ratio,
      evidenceStrength: "medium",
      urgency: "soon",
      difficulty: "moderate",
      impactEstimate: "medium",
    });
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Candidate → Recommendation mapper
// ---------------------------------------------------------------------------

const CATEGORY_TITLES: Record<string, { banker: string; borrower: string }> = {
  diligence_request:    { banker: "Request missing documentation",            borrower: "Upload missing documents" },
  structure_adjustment: { banker: "Consider loan structure adjustment",       borrower: "Improve financial position" },
  monitoring_step:      { banker: "Set up financial monitoring",              borrower: "Prepare financial statements" },
  memo_improvement:     { banker: "Enhance credit memo narrative",            borrower: "Review application summary" },
  document_fix:         { banker: "Follow up on document issues",             borrower: "Fix or re-upload documents" },
  cash_improvement:     { banker: "Advise on cash flow improvement",          borrower: "Strengthen cash flow metrics" },
  capital_structure:    { banker: "Review capital structure options",          borrower: "Consider equity injection or collateral" },
  lender_readiness:     { banker: "Assess lender readiness",                  borrower: "Complete lender readiness checklist" },
  operational_fix:      { banker: "Flag operational concern",                 borrower: "Improve working capital position" },
};

function toRecommendation(
  scored: ReturnType<typeof rankActions>[number],
  visibility: "banker" | "borrower",
): ActionRecommendation {
  const titles = CATEGORY_TITLES[scored.category] ?? { banker: scored.category, borrower: scored.category };
  return {
    visibility,
    actor: visibility === "banker" ? "underwriter" : "borrower",
    category: scored.category,
    title: visibility === "banker" ? titles.banker : titles.borrower,
    description: `Action targeting ${scored.metricAffected ?? "general deal health"}`,
    rationale: { evidenceStrength: scored.evidenceStrength, currentGap: scored.currentGap },
    blockedBy: {},
    expectedImpact: { impactEstimate: scored.impactEstimate },
    priorityScore: scored.priorityScore,
    urgencyScore: scored.urgencyScore,
    confidence: confidenceFromEvidence(scored.evidenceStrength),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateBankerActions(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<ActionRecommendation[]> {
  const [deal, snapshot, missingDocs] = await Promise.all([
    loadDealState(sb, dealId, bankId),
    loadLatestSnapshot(sb, dealId),
    loadMissingDocTypes(sb, dealId),
  ]);

  if (!deal) return [];

  const candidates = buildBankerCandidates(deal, snapshot, missingDocs);
  const ranked = rankActions(candidates);
  return ranked.map((s) => toRecommendation(s, "banker"));
}

export async function generateBorrowerActions(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<ActionRecommendation[]> {
  const [deal, snapshot, missingDocs] = await Promise.all([
    loadDealState(sb, dealId, bankId),
    loadLatestSnapshot(sb, dealId),
    loadMissingDocTypes(sb, dealId),
  ]);

  if (!deal) return [];

  const candidates = buildBorrowerCandidates(deal, snapshot, missingDocs);
  const ranked = rankActions(candidates);
  return ranked.map((s) => toRecommendation(s, "borrower"));
}

/**
 * Persist action recommendations to `buddy_action_recommendations`.
 */
export async function persistRecommendations(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
  recs: ActionRecommendation[],
): Promise<void> {
  if (recs.length === 0) return;

  const rows = recs.map((r) => actionRecommendationToRow(dealId, bankId, r));

  await sb.from("buddy_action_recommendations").insert(rows);
}
