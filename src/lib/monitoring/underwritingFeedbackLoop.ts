/**
 * Underwriting Feedback Loop — Phase 66B
 *
 * Feeds monitoring signals back into underwriting and borrower coaching systems.
 * Creates material change events and updates conclusion freshness.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Feed a monitoring signal into the underwriting system.
 * Records a material change event and updates affected conclusions' freshness.
 */
export async function feedSignalToUnderwriting(
  sb: SupabaseClient,
  signalId: string,
  dealId: string,
  bankId: string,
): Promise<void> {
  // Load the signal
  const { data: signal } = await sb
    .from("buddy_monitoring_signals")
    .select("signal_type, severity, direction, source_context_json")
    .eq("id", signalId)
    .single();

  if (!signal) return;

  // Record material change event
  const scope = signal.severity === "critical" ? "material" :
    signal.severity === "alert" ? "localized" : "trivial";

  await sb.from("buddy_material_change_events").insert({
    bank_id: bankId,
    deal_id: dealId,
    change_type: "monitoring_signal",
    change_scope: scope,
    materiality_score: signal.severity === "critical" ? "high" :
      signal.severity === "alert" ? "medium" : "low",
    affected_systems_json: {
      signal_type: signal.signal_type,
      severity: signal.severity,
      direction: signal.direction,
    },
    reuse_plan_json: {},
  });

  // Update affected conclusions to aging/stale
  if (signal.severity === "critical" || signal.severity === "alert") {
    await sb
      .from("buddy_conclusion_trust")
      .update({ freshness_status: "aging" })
      .eq("deal_id", dealId)
      .in("freshness_status", ["fresh"]);
  }

  // Mark signal as fed
  await sb
    .from("buddy_monitoring_signals")
    .update({ fed_into_underwriting: true })
    .eq("id", signalId);
}

/**
 * Feed a monitoring signal into borrower coaching.
 * Creates borrower-safe action recommendations from the signal.
 */
export async function feedSignalToBorrowerCoaching(
  sb: SupabaseClient,
  signalId: string,
  dealId: string,
  bankId: string,
): Promise<void> {
  const { data: signal } = await sb
    .from("buddy_monitoring_signals")
    .select("signal_type, severity, recommended_actions_json")
    .eq("id", signalId)
    .single();

  if (!signal) return;

  const actions = Array.isArray(signal.recommended_actions_json)
    ? signal.recommended_actions_json
    : [];

  // Create borrower-safe actions from signal recommendations
  for (const action of actions.slice(0, 3)) {
    const actionObj = typeof action === "object" && action !== null ? action as Record<string, unknown> : {};
    await sb.from("buddy_action_recommendations").insert({
      bank_id: bankId,
      deal_id: dealId,
      visibility_scope: "borrower",
      actor_type: "borrower",
      action_category: "operational_fix",
      priority_score: signal.severity === "critical" ? 90 :
        signal.severity === "alert" ? 70 : 50,
      urgency_score: signal.severity === "critical" ? 90 :
        signal.severity === "alert" ? 60 : 30,
      confidence_score: "medium",
      rationale_json: {
        title: actionObj.title ?? `Address ${signal.signal_type.replace(/_/g, " ")}`,
        description: actionObj.description ?? `Monitoring detected ${signal.signal_type.replace(/_/g, " ")} that may affect your application.`,
        source: "monitoring_signal",
      },
      blocked_by_json: {},
      expected_impact_json: { metric: signal.signal_type },
      status: "open",
    });
  }

  // Mark signal as fed into coaching
  await sb
    .from("buddy_monitoring_signals")
    .update({ fed_into_borrower_coaching: true })
    .eq("id", signalId);
}
