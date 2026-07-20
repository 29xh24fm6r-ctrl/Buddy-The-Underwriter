import "server-only";

import { generateMitigantConditionsForDeal } from "@/lib/conditions/generateMitigantConditions";
import { generateRuleConditionsForDeal } from "@/lib/conditions/generateRuleConditions";
import type { ConditionsSupabaseClient } from "@/lib/conditions/generateMitigantConditions";

export type GenerateConditionsForDealResult = {
  total_created: number;
  from_mitigants: number;
  from_rules: number;
  message: string;
};

/**
 * S7 pipeline stage: generates deal_conditions rows from both the
 * mitigant-driven generator (deal_mitigants -> policy-source conditions)
 * and the rule-based generator (CONDITION_RULES evaluated against real
 * document-presence signals -> system-source conditions). Both target
 * generators are independently idempotent via deal_conditions's
 * (deal_id, source, source_key) unique constraint, so this function is
 * safe to call on every pipeline run.
 */
export async function generateConditionsForDeal(
  dealId: string,
  bankId: string,
  opts: { sb?: ConditionsSupabaseClient } = {},
): Promise<GenerateConditionsForDealResult> {
  const [mitigantResult, ruleResult] = await Promise.all([
    generateMitigantConditionsForDeal(dealId, bankId, { sb: opts.sb }),
    generateRuleConditionsForDeal(dealId, bankId, { sb: opts.sb }),
  ]);

  const totalCreated = mitigantResult.created.length + ruleResult.created.length;

  return {
    total_created: totalCreated,
    from_mitigants: mitigantResult.created.length,
    from_rules: ruleResult.created.length,
    message:
      totalCreated > 0
        ? `${totalCreated} condition(s) generated (${mitigantResult.created.length} from mitigants, ${ruleResult.created.length} from rules)`
        : "No new conditions to generate",
  };
}
