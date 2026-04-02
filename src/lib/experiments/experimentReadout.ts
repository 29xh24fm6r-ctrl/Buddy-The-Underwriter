/**
 * Experiment Readout — Phase 66C, System 7
 *
 * Reads experiment results by counting assignments per variant and
 * joining with outcome events to compute KPI values per variant.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ExperimentReadout = {
  experimentId: string;
  name: string;
  domain: string;
  variants: {
    key: string;
    assignmentCount: number;
    kpiValue: number;
  }[];
  winningVariant: string | null;
  confidence: number;
};

/* ------------------------------------------------------------------ */
/*  getExperimentReadout                                               */
/* ------------------------------------------------------------------ */

export async function getExperimentReadout(
  sb: SupabaseClient,
  experimentId: string,
): Promise<ExperimentReadout> {
  /* Fetch experiment metadata */
  const { data: experiment, error: expErr } = await sb
    .from("buddy_experiments")
    .select("id, name, domain, definition")
    .eq("id", experimentId)
    .single();

  if (expErr || !experiment) {
    throw new Error(`Experiment not found: ${expErr?.message ?? experimentId}`);
  }

  const definition = experiment.definition as { variants: string[]; kpi: string };

  /* Fetch all assignments for this experiment */
  const { data: assignments, error: assignErr } = await sb
    .from("buddy_experiment_assignments")
    .select("variant_key, deal_id")
    .eq("experiment_id", experimentId);

  if (assignErr) {
    throw new Error(`Failed to fetch assignments: ${assignErr.message}`);
  }

  /* Count assignments per variant */
  const variantAssignments = new Map<string, { count: number; dealIds: Set<string> }>();

  for (const variant of definition.variants) {
    variantAssignments.set(variant, { count: 0, dealIds: new Set() });
  }

  for (const row of assignments ?? []) {
    const entry = variantAssignments.get(row.variant_key);
    if (entry) {
      entry.count++;
      if (row.deal_id) entry.dealIds.add(row.deal_id);
    }
  }

  /* Fetch outcome events for assigned deals to compute KPI */
  const allDealIds = new Set<string>();
  for (const entry of variantAssignments.values()) {
    for (const dealId of entry.dealIds) allDealIds.add(dealId);
  }

  const dealOutcomes = new Map<string, number>();

  if (allDealIds.size > 0) {
    const { data: outcomes } = await sb
      .from("buddy_banker_trust_events")
      .select("deal_id, event_type")
      .in("deal_id", [...allDealIds])
      .eq("event_type", "acceptance");

    for (const row of outcomes ?? []) {
      dealOutcomes.set(row.deal_id, (dealOutcomes.get(row.deal_id) ?? 0) + 1);
    }
  }

  /* Compute KPI (acceptance rate) per variant */
  const variants = definition.variants.map((key) => {
    const entry = variantAssignments.get(key)!;
    let totalOutcomes = 0;
    for (const dealId of entry.dealIds) {
      totalOutcomes += dealOutcomes.get(dealId) ?? 0;
    }
    const kpiValue = entry.dealIds.size > 0 ? totalOutcomes / entry.dealIds.size : 0;

    return {
      key,
      assignmentCount: entry.count,
      kpiValue,
    };
  });

  /* Determine winning variant (highest KPI, minimum 10 assignments) */
  const eligible = variants.filter((v) => v.assignmentCount >= 10);
  let winningVariant: string | null = null;
  let confidence = 0;

  if (eligible.length >= 2) {
    const sorted = [...eligible].sort((a, b) => b.kpiValue - a.kpiValue);
    const best = sorted[0];
    const runnerUp = sorted[1];

    if (best.kpiValue > runnerUp.kpiValue) {
      winningVariant = best.key;
      /* Simple confidence: proportional to the gap between best and runner-up */
      const gap = best.kpiValue - runnerUp.kpiValue;
      const avgKpi = (best.kpiValue + runnerUp.kpiValue) / 2;
      confidence = avgKpi > 0 ? Math.min(gap / avgKpi, 1) : 0;
    }
  }

  return {
    experimentId: experiment.id,
    name: experiment.name,
    domain: experiment.domain,
    variants,
    winningVariant,
    confidence,
  };
}
