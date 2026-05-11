/**
 * SPEC-B4 — Load deal methodology slate.
 *
 * Reads banker choices from deal_methodology_choices, merges over
 * DEFAULT_METHODOLOGY_SLATE per-axis. Missing axes use defaults.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MethodologyAxisId, MethodologyChoice, MethodologySlate } from "./types";
import { DEFAULT_METHODOLOGY_SLATE } from "./methodologyDefaults";
import { ALL_METHODOLOGY_AXIS_IDS } from "./methodologyAxes";

export type LoadDealMethodologyResult = {
  slate: MethodologySlate;
  choices: MethodologyChoice[];
  isAllDefaults: boolean;
};

/**
 * Load the effective methodology slate for a deal.
 * Banker choices override defaults per-axis. Missing axes use defaults.
 */
export async function loadDealMethodology(
  dealId: string,
  bankId: string,
): Promise<LoadDealMethodologyResult> {
  const sb = supabaseAdmin();

  const { data: rows, error } = await sb
    .from("deal_methodology_choices")
    .select("axis, variant, chosen_at, chosen_by_user_id, reason")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId);

  if (error) {
    console.warn("[loadDealMethodology] DB read failed, using defaults:", error.message);
    return {
      slate: { ...DEFAULT_METHODOLOGY_SLATE },
      choices: [],
      isAllDefaults: true,
    };
  }

  const choices: MethodologyChoice[] = (rows ?? []).map((r: any) => ({
    axis: r.axis as MethodologyAxisId,
    variant: r.variant,
    chosenAt: r.chosen_at,
    chosenBy: r.chosen_by_user_id,
    reason: r.reason,
  }));

  // Merge banker choices over defaults
  const slate: MethodologySlate = { ...DEFAULT_METHODOLOGY_SLATE };
  for (const choice of choices) {
    if (choice.axis in slate) {
      (slate as any)[choice.axis] = choice.variant;
    }
  }

  const isAllDefaults = choices.length === 0 || ALL_METHODOLOGY_AXIS_IDS.every(
    (axisId) => slate[axisId] === DEFAULT_METHODOLOGY_SLATE[axisId],
  );

  return { slate, choices, isAllDefaults };
}
