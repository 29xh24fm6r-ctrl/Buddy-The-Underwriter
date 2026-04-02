/**
 * Assignment Engine — Phase 66C, System 7
 *
 * Assigns actors to experiment variants using deterministic hashing.
 * Ensures consistent assignment for the same (experiment, bank, deal) tuple.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* ------------------------------------------------------------------ */
/*  Deterministic hash → variant index                                 */
/* ------------------------------------------------------------------ */

function deterministicHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/* ------------------------------------------------------------------ */
/*  assignToExperiment                                                 */
/* ------------------------------------------------------------------ */

export async function assignToExperiment(
  sb: SupabaseClient,
  experimentId: string,
  bankId: string,
  dealId: string,
  actorType: string,
): Promise<string> {
  /* Check for existing assignment */
  const existing = await getAssignment(sb, experimentId, bankId, dealId);
  if (existing) return existing;

  /* Fetch experiment to get variant list */
  const { data: experiment, error: expErr } = await sb
    .from("buddy_experiments")
    .select("definition")
    .eq("id", experimentId)
    .single();

  if (expErr || !experiment) {
    throw new Error(`Experiment not found: ${expErr?.message ?? experimentId}`);
  }

  const definition = experiment.definition as { variants: string[] };
  const variants = definition.variants;
  if (!variants || variants.length === 0) {
    throw new Error("Experiment has no variants defined");
  }

  /* Deterministic assignment based on hash */
  const hashInput = `${experimentId}:${bankId}:${dealId}`;
  const index = deterministicHash(hashInput) % variants.length;
  const variantKey = variants[index];

  /* Persist assignment */
  const { error: insertErr } = await sb
    .from("buddy_experiment_assignments")
    .insert({
      experiment_id: experimentId,
      bank_id: bankId,
      deal_id: dealId,
      actor_type: actorType,
      variant_key: variantKey,
    });

  if (insertErr) {
    /* Race condition — another assignment may have been created */
    const raceCheck = await getAssignment(sb, experimentId, bankId, dealId);
    if (raceCheck) return raceCheck;
    throw new Error(`Failed to assign experiment: ${insertErr.message}`);
  }

  return variantKey;
}

/* ------------------------------------------------------------------ */
/*  getAssignment                                                      */
/* ------------------------------------------------------------------ */

export async function getAssignment(
  sb: SupabaseClient,
  experimentId: string,
  bankId: string,
  dealId?: string,
): Promise<string | null> {
  let query = sb
    .from("buddy_experiment_assignments")
    .select("variant_key")
    .eq("experiment_id", experimentId)
    .eq("bank_id", bankId);

  if (dealId) {
    query = query.eq("deal_id", dealId);
  }

  const { data, error } = await query.limit(1).single();

  if (error || !data) return null;
  return data.variant_key as string;
}
