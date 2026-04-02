/**
 * Borrower Readiness Planner — Phase 66B Decision & Action Engine
 *
 * Server module. Creates and updates borrower readiness paths by
 * identifying the primary constraint, building milestones, and
 * sequencing recommended actions.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Milestone {
  label: string;
  target: string;
  current: string;
  met: boolean;
  priority: number;
}

export interface SequenceStep {
  order: number;
  action: string;
  expectedImpact: string;
  difficulty: "easy" | "moderate" | "hard";
}

export interface ReadinessPath {
  status: "on_track" | "at_risk" | "off_track" | "ready";
  primaryConstraint: string;
  secondaryConstraints: string[];
  milestones: Milestone[];
  recommendedSequence: SequenceStep[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface DealInfo {
  loan_amount: number | null;
  loan_type: string | null;
  status: string | null;
}

interface SnapshotInfo {
  dscr: number | null;
  ltv: number | null;
  debt_yield: number | null;
  current_ratio: number | null;
}

async function loadDeal(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<DealInfo | null> {
  const { data } = await sb
    .from("deals")
    .select("loan_amount, loan_type, status")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .single();
  return data as DealInfo | null;
}

async function loadSnapshot(
  sb: SupabaseClient,
  dealId: string,
): Promise<SnapshotInfo | null> {
  const { data } = await sb
    .from("deal_financial_snapshots")
    .select("dscr, ltv, debt_yield, current_ratio")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as SnapshotInfo | null;
}

async function loadMissingDocCount(
  sb: SupabaseClient,
  dealId: string,
): Promise<number> {
  const { count } = await sb
    .from("deal_document_slots")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("status", "missing");
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Milestone builders
// ---------------------------------------------------------------------------

function buildMilestones(
  snapshot: SnapshotInfo | null,
  missingDocs: number,
): Milestone[] {
  const milestones: Milestone[] = [];
  let priority = 1;

  // Documentation completeness
  milestones.push({
    label: "Complete required documentation",
    target: "0 missing documents",
    current: `${missingDocs} missing`,
    met: missingDocs === 0,
    priority: missingDocs > 0 ? priority++ : 99,
  });

  // DSCR
  if (snapshot?.dscr != null) {
    const met = snapshot.dscr >= 1.25;
    milestones.push({
      label: "Achieve minimum DSCR",
      target: ">= 1.25x",
      current: `${snapshot.dscr.toFixed(2)}x`,
      met,
      priority: met ? 99 : priority++,
    });
  } else {
    milestones.push({
      label: "Provide financial data for DSCR calculation",
      target: "DSCR calculable",
      current: "No data",
      met: false,
      priority: priority++,
    });
  }

  // LTV
  if (snapshot?.ltv != null) {
    const met = snapshot.ltv <= 80;
    milestones.push({
      label: "Achieve acceptable LTV",
      target: "<= 80%",
      current: `${snapshot.ltv.toFixed(1)}%`,
      met,
      priority: met ? 99 : priority++,
    });
  }

  // Current ratio
  if (snapshot?.current_ratio != null) {
    const met = snapshot.current_ratio >= 1.2;
    milestones.push({
      label: "Maintain adequate liquidity",
      target: ">= 1.2x current ratio",
      current: `${snapshot.current_ratio.toFixed(2)}x`,
      met,
      priority: met ? 99 : priority++,
    });
  }

  return milestones.sort((a, b) => a.priority - b.priority);
}

function identifyPrimaryConstraint(milestones: Milestone[]): string {
  const unmet = milestones.filter((m) => !m.met);
  if (unmet.length === 0) return "none";
  return unmet[0].label;
}

function identifySecondaryConstraints(milestones: Milestone[]): string[] {
  const unmet = milestones.filter((m) => !m.met);
  return unmet.slice(1).map((m) => m.label);
}

function deriveStatus(milestones: Milestone[]): ReadinessPath["status"] {
  const unmet = milestones.filter((m) => !m.met);
  if (unmet.length === 0) return "ready";
  if (unmet.length === 1) return "on_track";
  if (unmet.length <= 3) return "at_risk";
  return "off_track";
}

function buildSequence(milestones: Milestone[]): SequenceStep[] {
  const unmet = milestones.filter((m) => !m.met);
  return unmet.map((m, idx) => ({
    order: idx + 1,
    action: m.label,
    expectedImpact: `Move ${m.current} toward ${m.target}`,
    difficulty: idx === 0 ? "easy" as const : idx < 3 ? "moderate" as const : "hard" as const,
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a borrower readiness path for a deal, identifying the primary
 * constraint, building milestones, and persisting to
 * `buddy_borrower_readiness_paths`.
 */
export async function generateReadinessPath(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<ReadinessPath> {
  const [deal, snapshot, missingDocs] = await Promise.all([
    loadDeal(sb, dealId, bankId),
    loadSnapshot(sb, dealId),
    loadMissingDocCount(sb, dealId),
  ]);

  const milestones = buildMilestones(snapshot, missingDocs);
  const primaryConstraint = identifyPrimaryConstraint(milestones);
  const secondaryConstraints = identifySecondaryConstraints(milestones);
  const status = deriveStatus(milestones);
  const recommendedSequence = buildSequence(milestones);

  const path: ReadinessPath = {
    status,
    primaryConstraint,
    secondaryConstraints,
    milestones,
    recommendedSequence,
  };

  // Persist
  await sb.from("buddy_borrower_readiness_paths").upsert(
    {
      deal_id: dealId,
      bank_id: bankId,
      status: path.status,
      primary_constraint: path.primaryConstraint,
      secondary_constraints: path.secondaryConstraints,
      milestones: path.milestones,
      recommended_sequence: path.recommendedSequence,
    },
    { onConflict: "deal_id" },
  );

  return path;
}
