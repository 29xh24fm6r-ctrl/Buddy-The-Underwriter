import "server-only";

/**
 * Phase 55F — Apply Credit Action Recommendation
 *
 * Converts accepted recommendations into target-system records.
 * Supports accept, modify, dismiss, and convert flows.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { ActionStatus } from "./credit-action-types";

type ApplyInput = {
  actionId: string;
  dealId: string;
  bankId: string;
  action: "accept" | "modify" | "dismiss" | "convert";
  actorUserId: string;
  modifiedText?: string;
  targetSystem?: string;
  rationale?: string;
};

type ApplyResult = {
  ok: true;
  actionId: string;
  newStatus: ActionStatus;
  targetRecordId: string | null;
} | {
  ok: false;
  error: string;
};

export async function applyCreditActionRecommendation(input: ApplyInput): Promise<ApplyResult> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  try {
    // Load the recommendation
    const { data: rec, error: loadErr } = await sb
      .from("credit_action_recommendations")
      .select("id, deal_id, action_type, recommended_text, proposed_terms_json, category")
      .eq("id", input.actionId)
      .eq("deal_id", input.dealId)
      .maybeSingle();

    if (loadErr || !rec) {
      return { ok: false, error: "Recommendation not found" };
    }

    let newStatus: ActionStatus;
    let targetRecordId: string | null = null;

    switch (input.action) {
      case "accept":
        newStatus = "accepted";
        break;
      case "modify":
        if (!input.modifiedText) return { ok: false, error: "modify requires modifiedText" };
        newStatus = "modified";
        break;
      case "dismiss":
        if (!input.rationale) return { ok: false, error: "dismiss requires rationale" };
        newStatus = "dismissed";
        break;
      case "convert":
        newStatus = "implemented";
        // Create target record based on action type
        targetRecordId = await convertToTargetSystem(sb, {
          dealId: input.dealId,
          bankId: input.bankId,
          actionType: rec.action_type,
          text: input.modifiedText ?? rec.recommended_text,
          category: rec.category,
          proposedTerms: rec.proposed_terms_json,
          actorUserId: input.actorUserId,
        });
        break;
      default:
        return { ok: false, error: `Unknown action: ${input.action}` };
    }

    // Update recommendation
    await sb
      .from("credit_action_recommendations")
      .update({
        status: newStatus,
        accepted_by: input.actorUserId,
        accepted_at: now,
        modified_text: input.modifiedText ?? null,
        target_record_id: targetRecordId,
        updated_at: now,
      })
      .eq("id", input.actionId);

    // Audit
    await logLedgerEvent({
      dealId: input.dealId,
      bankId: input.bankId,
      eventKey: `credit_action.${input.action}`,
      uiState: "done",
      uiMessage: `Credit action ${input.action}: ${rec.action_type}`,
      meta: {
        action_id: input.actionId,
        action_type: rec.action_type,
        new_status: newStatus,
        target_record_id: targetRecordId,
        actor: input.actorUserId,
      },
    }).catch(() => {});

    return { ok: true, actionId: input.actionId, newStatus, targetRecordId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function convertToTargetSystem(
  sb: ReturnType<typeof supabaseAdmin>,
  opts: {
    dealId: string;
    bankId: string;
    actionType: string;
    text: string;
    category: string;
    proposedTerms: any;
    actorUserId: string;
  },
): Promise<string | null> {
  const { dealId, bankId, actionType, text, category, proposedTerms, actorUserId } = opts;

  // Convert to condition
  if (actionType === "add_condition" || actionType === "add_collateral_support" || actionType === "add_guaranty_support") {
    const { data: cond } = await sb
      .from("deal_conditions")
      .insert({
        deal_id: dealId,
        bank_id: bankId,
        title: text,
        description: proposedTerms?.conditionText ?? text,
        category: category === "collateral" ? "closing" : "credit",
        source: "system",
        status: "open",
        created_by: actorUserId,
      })
      .select("id")
      .single();
    return cond?.id ?? null;
  }

  // For other types, return null (deep-link only, no automatic record creation)
  return null;
}
