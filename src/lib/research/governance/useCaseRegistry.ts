/**
 * AI Use Case Governance Registry
 *
 * Runtime enforcement layer between the research planner and mission execution.
 *
 * Rule: A mission may ONLY auto-run if:
 *   approval_status = 'approved' AND automation_level = 'auto'
 *
 * If automation_level = 'human_in_loop', the mission is proposed but requires
 * explicit banker approval before execution.
 *
 * If approval_status = 'restricted', the mission is blocked entirely.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { MissionType } from "../types";

// ============================================================================
// Types
// ============================================================================

export type RiskTier = "low" | "medium" | "high";
export type AutomationLevel = "auto" | "human_in_loop" | "restricted";
export type ApprovalStatus = "approved" | "pending_review" | "restricted";

export type AIUseCase = {
  id: string;
  mission_type: MissionType;
  name: string;
  description: string;
  risk_tier: RiskTier;
  automation_level: AutomationLevel;
  approval_status: ApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GovernanceCheckResult = {
  allowed: boolean;
  requires_approval: boolean;
  reason: string;
  use_case: AIUseCase | null;
};

// ============================================================================
// Registry Lookup
// ============================================================================

/**
 * Fetch all AI use cases from the registry.
 */
export async function getAllUseCases(): Promise<AIUseCase[]> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("buddy_ai_use_cases")
    .select("*")
    .order("mission_type");

  if (error) {
    console.warn("[useCaseRegistry] Failed to fetch use cases:", error.message);
    return [];
  }

  return (data ?? []) as AIUseCase[];
}

/**
 * Fetch a single use case by mission type.
 */
export async function getUseCaseByMissionType(
  missionType: MissionType
): Promise<AIUseCase | null> {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("buddy_ai_use_cases")
    .select("*")
    .eq("mission_type", missionType)
    .maybeSingle();

  if (error) {
    console.warn("[useCaseRegistry] Lookup failed:", error.message);
    return null;
  }

  return data as AIUseCase | null;
}

// ============================================================================
// Runtime Enforcement
// ============================================================================

/**
 * Check whether a mission type is allowed to execute.
 *
 * Returns:
 * - allowed=true, requires_approval=false → auto-run OK
 * - allowed=true, requires_approval=true → needs banker approval first
 * - allowed=false → blocked (restricted or not registered)
 */
export async function checkMissionGovernance(
  missionType: MissionType
): Promise<GovernanceCheckResult> {
  const useCase = await getUseCaseByMissionType(missionType);

  // Not registered → allow with warning (graceful fallback)
  if (!useCase) {
    return {
      allowed: true,
      requires_approval: true,
      reason: `Mission type '${missionType}' not found in AI Use Case Registry. Requires manual approval.`,
      use_case: null,
    };
  }

  // Restricted → blocked
  if (useCase.approval_status === "restricted") {
    return {
      allowed: false,
      requires_approval: false,
      reason: `Mission type '${missionType}' is restricted by governance policy.`,
      use_case: useCase,
    };
  }

  // Automation level = restricted → blocked
  if (useCase.automation_level === "restricted") {
    return {
      allowed: false,
      requires_approval: false,
      reason: `Mission type '${missionType}' automation is restricted.`,
      use_case: useCase,
    };
  }

  // Human-in-loop → allowed but requires approval
  if (useCase.automation_level === "human_in_loop") {
    return {
      allowed: true,
      requires_approval: true,
      reason: `Mission type '${missionType}' requires human approval (${useCase.risk_tier} risk).`,
      use_case: useCase,
    };
  }

  // Pending review → allowed but requires approval
  if (useCase.approval_status === "pending_review") {
    return {
      allowed: true,
      requires_approval: true,
      reason: `Mission type '${missionType}' is pending governance review.`,
      use_case: useCase,
    };
  }

  // Auto + approved → full auto-run
  return {
    allowed: true,
    requires_approval: false,
    reason: `Mission type '${missionType}' approved for automated execution.`,
    use_case: useCase,
  };
}

/**
 * Check if a mission can auto-execute (no human approval needed).
 *
 * This is the primary enforcement function used by the planner.
 * Rule: approval_status = 'approved' AND automation_level = 'auto'
 */
export async function canAutoExecute(missionType: MissionType): Promise<boolean> {
  const result = await checkMissionGovernance(missionType);
  return result.allowed && !result.requires_approval;
}
