/**
 * Apply a structuring recommendation to the Builder.
 * Only safe action kinds are applied as direct mutations.
 * Server module — uses Supabase client.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuringScenario } from "./types";
import { writeBuilderDecision } from "@/lib/builder/builderDecisionWriter";

type ApplyResult = {
  ok: true;
  updated_fields: string[];
} | {
  ok: false;
  error: string;
};

/** Safe action kinds that can be directly applied to builder sections */
const SAFE_ACTION_KINDS = new Set(["set_loan_amount", "set_equity_amount", "set_equity_pct"]);

export async function applyStructuringRecommendation(args: {
  deal_id: string;
  bank_id?: string;
  scenario: StructuringScenario;
  acted_by: string;
  sb: SupabaseClient;
}): Promise<ApplyResult> {
  const { deal_id, bank_id, scenario, acted_by, sb } = args;
  const updatedFields: string[] = [];

  for (const action of scenario.actions) {
    if (!SAFE_ACTION_KINDS.has(action.kind)) continue;

    if (action.kind === "set_loan_amount") {
      // Update deal section
      const { data: existing } = await sb
        .from("deal_builder_sections")
        .select("data")
        .eq("deal_id", deal_id)
        .eq("section_key", "deal")
        .maybeSingle();

      const currentData = (existing as any)?.data ?? {};
      const previousAmount = currentData.requested_amount;

      await sb
        .from("deal_builder_sections")
        .upsert({
          deal_id,
          section_key: "deal",
          data: { ...currentData, requested_amount: action.to },
          updated_at: new Date().toISOString(),
        }, { onConflict: "deal_id,section_key" });

      updatedFields.push("deal.requested_amount");

      await writeBuilderDecision(sb, {
        dealId: deal_id,
        bankId: bank_id,
        decisionType: "advance_rate_overridden",
        entityType: "policy",
        fieldName: "requested_amount",
        previousValue: previousAmount,
        newValue: action.to,
        decisionReason: `Applied structuring recommendation: ${scenario.label}`,
        decisionSource: "user",
        createdBy: acted_by,
      });
    }

    if (action.kind === "set_equity_pct" || action.kind === "set_equity_amount") {
      const { data: existing } = await sb
        .from("deal_builder_sections")
        .select("data")
        .eq("deal_id", deal_id)
        .eq("section_key", "structure")
        .maybeSingle();

      const currentData = (existing as any)?.data ?? {};
      const updates: Record<string, unknown> = { ...currentData };

      if (action.kind === "set_equity_pct") {
        updates.equity_actual_pct = action.to;
        updatedFields.push("structure.equity_actual_pct");
      }
      if (action.kind === "set_equity_amount") {
        updates.equity_actual_amount = action.to;
        updatedFields.push("structure.equity_actual_amount");
      }

      await sb
        .from("deal_builder_sections")
        .upsert({
          deal_id,
          section_key: "structure",
          data: updates,
          updated_at: new Date().toISOString(),
        }, { onConflict: "deal_id,section_key" });

      await writeBuilderDecision(sb, {
        dealId: deal_id,
        bankId: bank_id,
        decisionType: "equity_requirement_overridden",
        entityType: "equity",
        fieldName: action.kind === "set_equity_pct" ? "equity_actual_pct" : "equity_actual_amount",
        previousValue: action.from,
        newValue: action.to,
        decisionReason: `Applied structuring recommendation: ${scenario.label}`,
        decisionSource: "user",
        createdBy: acted_by,
      });
    }
  }

  // Save recommendation snapshot
  await sb.from("structuring_recommendation_snapshots").insert({
    deal_id,
    generated_by: acted_by,
    applied_scenario_json: scenario,
  });

  return { ok: true, updated_fields: updatedFields };
}
