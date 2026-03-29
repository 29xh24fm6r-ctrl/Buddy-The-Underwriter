import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildRelationshipAutonomyPlan } from "./buildRelationshipAutonomyPlan";
import { validateRelationshipAutonomyGuardrails } from "./validateRelationshipAutonomyGuardrails";
import { logRelationshipAutonomyEvent } from "./logRelationshipAutonomyEvent";
import { isKillSwitchActive, isAutonomyFeatureEnabled } from "./relationshipAutonomyPolicy";
import type {
  RelationshipAutonomyPlan,
  RelationshipAutonomyGuardrailResult,
  RelationshipAutonomyMode,
} from "./types";
import type { RelationshipSurfaceItem } from "../relationship-surface/types";

/**
 * Full orchestrator: fetch context, build plan, validate, persist.
 * Never throws.
 */
export async function generateRelationshipAutonomyPlan(params: {
  relationshipId: string;
  bankId: string;
  userId: string;
}): Promise<{
  plan: RelationshipAutonomyPlan | null;
  guardrailResult: RelationshipAutonomyGuardrailResult;
}> {
  const sb = supabaseAdmin();

  try {
    // Load autonomy profile
    const { data: profile } = await sb
      .from("relationship_autonomy_profiles")
      .select("autonomy_mode")
      .eq("bank_id", params.bankId)
      .eq("user_id", params.userId)
      .maybeSingle();

    const mode = (profile?.autonomy_mode ?? "manual") as RelationshipAutonomyMode;

    if (mode === "manual") {
      return {
        plan: null,
        guardrailResult: { ok: false, errors: ["Autonomy mode is manual."], blockedActionIds: [] },
      };
    }

    // Load relationship surface snapshot
    const { data: snapshot } = await sb
      .from("relationship_surface_snapshots")
      .select("surface_payload")
      .eq("relationship_id", params.relationshipId)
      .eq("bank_id", params.bankId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const surfaceItem = snapshot?.surface_payload as unknown as RelationshipSurfaceItem | null;

    if (!surfaceItem) {
      return {
        plan: null,
        guardrailResult: { ok: false, errors: ["No surface data for relationship."], blockedActionIds: [] },
      };
    }

    // Build plan
    const plan = buildRelationshipAutonomyPlan({
      relationshipId: params.relationshipId,
      bankId: params.bankId,
      mode,
      canonicalState: surfaceItem.canonicalState,
      primaryReasonCode: surfaceItem.primaryReasonCode,
      primaryActionCode: surfaceItem.primaryActionCode,
      omegaRecommendations: [],
      nowIso: new Date().toISOString(),
    });

    if (!plan) {
      return {
        plan: null,
        guardrailResult: { ok: false, errors: ["No eligible actions found."], blockedActionIds: [] },
      };
    }

    // Validate guardrails
    const guardrailResult = validateRelationshipAutonomyGuardrails({
      plan,
      featureFlagEnabled: isAutonomyFeatureEnabled(),
      killSwitchActive: isKillSwitchActive(),
      hasIntegrityFailure: surfaceItem.primaryReasonCode.includes("integrity"),
      hasCriticalMonitoringException: surfaceItem.primaryReasonCode.includes("critical_monitoring"),
      hasCryptoLiquidationReview: surfaceItem.primaryReasonCode.includes("crypto_liquidation"),
      hasCriticalProtectionCase: surfaceItem.primaryReasonCode.includes("critical_protection"),
      hasRenewalPolicyHardStop: false,
      relationshipActive: true,
    });

    // Persist plan
    await sb.from("relationship_autonomy_plans").insert({
      relationship_id: params.relationshipId,
      bank_id: params.bankId,
      user_id: params.userId,
      autonomy_mode: mode,
      plan_payload: plan,
      rationale: plan.rationale,
      requires_approval: plan.requiresApproval,
      status: guardrailResult.ok ? "generated" : "blocked",
    });

    await logRelationshipAutonomyEvent({
      relationshipId: params.relationshipId,
      bankId: params.bankId,
      eventCode: guardrailResult.ok ? "autonomy_plan_generated" : "autonomy_plan_blocked",
      actorUserId: params.userId,
      payload: { mode, actionCount: plan.actions.length, guardrailErrors: guardrailResult.errors },
    });

    return { plan, guardrailResult };
  } catch (err) {
    console.error("[generateRelationshipAutonomyPlan] error:", err);
    return {
      plan: null,
      guardrailResult: { ok: false, errors: ["Internal error during plan generation."], blockedActionIds: [] },
    };
  }
}
