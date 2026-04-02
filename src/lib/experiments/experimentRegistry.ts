/**
 * Experiment Registry — Phase 66C, System 7
 *
 * Manages experiment lifecycle: creation, listing, and status updates.
 * Validates domains against guardrails before creation.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { validateExperimentDomain, validateExperimentDefinition } from "./experimentGuardrails";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ExperimentDefinition {
  variants: string[];
  kpi: string;
  rollbackCondition: string;
  guardrail: string;
}

export interface Experiment {
  id: string;
  name: string;
  domain: string;
  definition: ExperimentDefinition;
  status: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  createExperiment                                                   */
/* ------------------------------------------------------------------ */

export async function createExperiment(
  sb: SupabaseClient,
  input: {
    name: string;
    domain: string;
    definition: ExperimentDefinition;
  },
): Promise<string> {
  /* Validate domain */
  const domainCheck = validateExperimentDomain(input.domain);
  if (!domainCheck.allowed) {
    throw new Error(`Forbidden experiment domain: ${domainCheck.reason}`);
  }

  /* Validate definition */
  const defCheck = validateExperimentDefinition(input.definition);
  if (!defCheck.valid) {
    throw new Error(`Invalid experiment definition: ${defCheck.errors.join("; ")}`);
  }

  const { data, error } = await sb
    .from("buddy_experiments")
    .insert({
      name: input.name,
      domain: input.domain,
      definition: input.definition,
      status: "draft",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create experiment: ${error?.message ?? "unknown error"}`);
  }

  return data.id as string;
}

/* ------------------------------------------------------------------ */
/*  getActiveExperiments                                               */
/* ------------------------------------------------------------------ */

export async function getActiveExperiments(
  sb: SupabaseClient,
): Promise<Experiment[]> {
  const { data, error } = await sb
    .from("buddy_experiments")
    .select("*")
    .in("status", ["active", "draft"])
    .order("created_at", { ascending: false });

  if (error || !data) {
    console.error("[experimentRegistry] getActiveExperiments failed:", error?.message);
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    domain: row.domain,
    definition: row.definition as ExperimentDefinition,
    status: row.status,
    createdAt: row.created_at,
  }));
}

/* ------------------------------------------------------------------ */
/*  updateExperimentStatus                                             */
/* ------------------------------------------------------------------ */

export async function updateExperimentStatus(
  sb: SupabaseClient,
  experimentId: string,
  status: string,
): Promise<void> {
  const { error } = await sb
    .from("buddy_experiments")
    .update({ status })
    .eq("id", experimentId);

  if (error) {
    throw new Error(`Failed to update experiment status: ${error.message}`);
  }
}
