import "server-only";

/**
 * Brokerage stage transitions — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR3 §5.2.
 *
 * Every transition is checked against the stage matrix (stages.ts) and,
 * unless overridden, the entry gate (gates.ts) before deals.brokerage_stage
 * is written. Every transition — normal or overridden — is recorded in
 * deal_brokerage_stage_transitions for a complete audit trail.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { canTransition, isValidBrokerageStage, type BrokerageStage } from "./stages";
import { checkStageGate } from "./gates";

export type DealBrokerageStageRow = {
  id: string;
  bank_id: string;
  brokerage_stage: BrokerageStage | null;
  brokerage_stage_entered_at: string | null;
  brokerage_stage_owner_clerk_user_id: string | null;
  [key: string]: unknown;
};

async function getDealOrThrow(bankId: string, dealId: string, sb: SB): Promise<DealBrokerageStageRow> {
  const { data, error } = await sb
    .from("deals")
    .select("id, bank_id, brokerage_stage, brokerage_stage_entered_at, brokerage_stage_owner_clerk_user_id")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .single();
  if (error || !data) throw new Error(`Deal not found (${error?.message ?? "no such deal"}).`);
  return data as DealBrokerageStageRow;
}

export type TransitionDealStageInput = {
  bankId: string;
  dealId: string;
  toStage: string;
  actorClerkUserId: string;
  reason?: string | null;
  /** Bypasses the entry gate — requires an authorized role check at the caller (route) level. */
  override?: boolean;
};

export type TransitionDealStageResult = {
  deal: DealBrokerageStageRow;
  wasOverride: boolean;
};

export async function transitionDealStage(input: TransitionDealStageInput, sb: SB = supabaseAdmin()): Promise<TransitionDealStageResult> {
  if (!isValidBrokerageStage(input.toStage)) {
    throw new Error(`Unknown brokerage stage: ${input.toStage}`);
  }
  const toStage = input.toStage as BrokerageStage;

  const deal = await getDealOrThrow(input.bankId, input.dealId, sb);
  const fromStage: BrokerageStage = deal.brokerage_stage ?? "intake";

  if (!input.override && !canTransition(fromStage, toStage)) {
    throw new Error(`Cannot transition deal from '${fromStage}' to '${toStage}'.`);
  }
  // Even an override must move somewhere real — it bypasses the *gate*
  // (readiness requirements), not the *matrix* (which stages exist and are
  // reachable at all), matching the spec's own "controlled override" framing.
  if (input.override && !canTransition(fromStage, toStage)) {
    throw new Error(`Cannot override to '${toStage}' — it is not a reachable stage from '${fromStage}'.`);
  }

  if ((toStage === "withdrawn" || toStage === "declined" || toStage === "lost") && !input.reason) {
    throw new Error(`A deal cannot be marked '${toStage}' without a reason.`);
  }

  let missingRequirements: string[] = [];
  if (!input.override) {
    const gate = await checkStageGate(fromStage, toStage, input.dealId, sb);
    if (!gate.canAdvance) {
      throw new Error(`Stage gate failed: ${gate.missingRequirements.join("; ")}`);
    }
  } else {
    const gate = await checkStageGate(fromStage, toStage, input.dealId, sb);
    missingRequirements = gate.missingRequirements;
    if (!input.reason) {
      throw new Error("An override requires a reason.");
    }
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await sb
    .from("deals")
    .update({ brokerage_stage: toStage, brokerage_stage_entered_at: now })
    .eq("id", input.dealId)
    .eq("bank_id", input.bankId)
    .select("id, bank_id, brokerage_stage, brokerage_stage_entered_at, brokerage_stage_owner_clerk_user_id")
    .single();
  if (updateErr) throw new Error(`transitionDealStage update failed: ${updateErr.message}`);

  await sb.from("deal_brokerage_stage_transitions").insert({
    bank_id: input.bankId,
    deal_id: input.dealId,
    from_stage: deal.brokerage_stage,
    to_stage: toStage,
    reason: input.reason ?? null,
    is_override: !!input.override,
    missing_requirements: missingRequirements,
    actor_clerk_user_id: input.actorClerkUserId,
  });

  return { deal: updated as DealBrokerageStageRow, wasOverride: !!input.override };
}

export type AssignDealStageOwnerInput = {
  bankId: string;
  dealId: string;
  ownerClerkUserId: string | null;
};

export async function assignDealStageOwner(input: AssignDealStageOwnerInput, sb: SB = supabaseAdmin()): Promise<void> {
  const { error } = await sb
    .from("deals")
    .update({ brokerage_stage_owner_clerk_user_id: input.ownerClerkUserId })
    .eq("id", input.dealId)
    .eq("bank_id", input.bankId);
  if (error) throw new Error(`assignDealStageOwner failed: ${error.message}`);
}
