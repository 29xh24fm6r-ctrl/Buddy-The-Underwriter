import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TrustGrade } from "./completionGate";

/**
 * Phase 79: Centralized trust grade enforcement.
 *
 * Single helper that governs whether downstream actions (memo, committee
 * packet, committee approval) may proceed based on the research trust grade.
 *
 * Rules:
 *   committee_grade        → all actions allowed
 *   preliminary            → memo allowed, committee blocked
 *   manual_review_required → committee blocked
 *   research_failed        → memo + committee blocked
 *   null / missing         → treated as "not yet run" — memo allowed (soft), committee blocked
 */

export type TrustAction = "memo" | "committee_packet" | "committee_approval";

export type TrustEnforcementResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export function enforceResearchTrust(
  trustGrade: TrustGrade | string | null | undefined,
  action: TrustAction,
): TrustEnforcementResult {
  // Memo generation: soft gate — only block on research_failed
  if (action === "memo") {
    if (trustGrade === "research_failed") {
      return {
        allowed: false,
        reason: "Cannot generate memo: research failed. Re-run research or resolve failures first.",
      };
    }
    return { allowed: true };
  }

  // Committee packet: requires committee_grade
  if (action === "committee_packet") {
    if (!trustGrade) {
      return {
        allowed: false,
        reason: "Committee packet requires completed research. Run Buddy Research first.",
      };
    }
    if (trustGrade !== "committee_grade") {
      return {
        allowed: false,
        reason: `Committee packet requires committee-grade research. Current grade: ${trustGrade}.`,
      };
    }
    return { allowed: true };
  }

  // Committee approval: requires committee_grade
  if (action === "committee_approval") {
    if (!trustGrade) {
      return {
        allowed: false,
        reason: "Deal cannot advance to committee: research not yet run.",
      };
    }
    if (trustGrade !== "committee_grade") {
      return {
        allowed: false,
        reason: `Deal cannot advance to committee: research is ${trustGrade}, not committee-grade.`,
      };
    }
    return { allowed: true };
  }

  return { allowed: true };
}

/**
 * Convenience: load trust grade for a deal from buddy_research_quality_gates,
 * then enforce.
 */
export async function loadAndEnforceResearchTrust(
  dealId: string,
  action: TrustAction,
): Promise<TrustEnforcementResult> {
  const grade = await loadTrustGradeForDeal(dealId);
  return enforceResearchTrust(grade, action);
}

/**
 * Load the latest trust grade for a deal.
 */
export async function loadTrustGradeForDeal(
  dealId: string,
): Promise<TrustGrade | null> {
  try {
    const sb = supabaseAdmin();

    // Find latest completed mission for this deal
    const { data: mission } = await (sb as any)
      .from("buddy_research_missions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("status", "complete")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!mission) return null;

    const { data: gate } = await (sb as any)
      .from("buddy_research_quality_gates")
      .select("trust_grade")
      .eq("mission_id", mission.id)
      .maybeSingle();

    return (gate?.trust_grade as TrustGrade) ?? null;
  } catch {
    // Fail-open for trust grade loading — don't block on infra failure
    return null;
  }
}
