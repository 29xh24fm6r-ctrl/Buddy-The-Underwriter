/**
 * Persistent builder decision writer.
 * Records banker decisions (overrides, acceptances, dismissals) to builder_decisions table.
 * Server module — uses Supabase client.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────

export type BuilderDecisionType =
  | "owner_accepted"
  | "owner_dismissed"
  | "owner_edited"
  | "advance_rate_overridden"
  | "equity_requirement_overridden"
  | "valuation_method_selected"
  | "policy_rule_applied";

export type BuilderDecisionInput = {
  dealId: string;
  bankId?: string;
  decisionType: BuilderDecisionType;
  entityType?: "collateral" | "owner" | "equity" | "policy";
  entityId?: string;
  fieldName?: string;
  previousValue?: unknown;
  newValue?: unknown;
  decisionReason?: string;
  decisionSource?: "user" | "system";
  createdBy?: string;
};

// ── Writer ───────────────────────────────────────────────────────

/**
 * Write a builder decision record. Best-effort — never throws.
 */
export async function writeBuilderDecision(
  sb: SupabaseClient,
  input: BuilderDecisionInput,
): Promise<void> {
  try {
    await sb.from("builder_decisions").insert({
      deal_id: input.dealId,
      bank_id: input.bankId ?? null,
      decision_type: input.decisionType,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      field_name: input.fieldName ?? null,
      previous_value: input.previousValue != null ? JSON.stringify(input.previousValue) : null,
      new_value: input.newValue != null ? JSON.stringify(input.newValue) : null,
      decision_reason: input.decisionReason ?? null,
      decision_source: input.decisionSource ?? "user",
      created_by: input.createdBy ?? null,
    });
  } catch (err) {
    console.error("[builderDecisionWriter] write failed:", err);
  }
}

/**
 * Load builder decisions for a deal. Used for audit display.
 */
export async function loadBuilderDecisions(
  sb: SupabaseClient,
  dealId: string,
): Promise<BuilderDecisionInput[]> {
  const { data, error } = await sb
    .from("builder_decisions")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[builderDecisionWriter] load failed:", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    dealId: row.deal_id,
    bankId: row.bank_id,
    decisionType: row.decision_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fieldName: row.field_name,
    previousValue: row.previous_value,
    newValue: row.new_value,
    decisionReason: row.decision_reason,
    decisionSource: row.decision_source,
    createdBy: row.created_by,
  }));
}
