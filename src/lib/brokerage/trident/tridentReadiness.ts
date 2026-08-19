import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateTridentResearchTrust } from "./tridentReleaseGate";

export type TridentReadiness = {
  ok: boolean;
  reasons: string[];
  warnings: string[];
  evidence: {
    assumptionsStatus: string | null;
    documentCount: number;
    financialFactCount: number;
    useOfProceedsCount: number;
    validationStatus: string | null;
    researchTrustGrade: string | null;
    isTestDeal: boolean;
    confirmedRevenueStreams: number;
    managementMembers: number;
  };
};

/**
 * Quality-lab admission gate. Admission and final release share the same
 * research policy so a job that passes this gate is not doomed by a hidden
 * downstream trust-grade requirement.
 */
export async function getTridentReadiness(args: {
  sb: SupabaseClient;
  dealId: string;
  bankId: string;
}): Promise<TridentReadiness> {
  const { sb, dealId, bankId } = args;
  const [
    assumptionsResult,
    documentsResult,
    factsResult,
    proceedsResult,
    validationResult,
    dealResult,
    missionResult,
  ] = await Promise.all([
    sb
      .from("buddy_sba_assumptions")
      .select("status,revenue_streams,cost_assumptions,working_capital,loan_impact,management_team")
      .eq("deal_id", dealId)
      .maybeSingle(),
    sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", bankId),
    sb
      .from("deal_financial_facts")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", bankId),
    sb
      .from("deal_proceeds_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId),
    sb
      .from("buddy_validation_reports")
      .select("overall_status")
      .eq("deal_id", dealId)
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("deals")
      .select("is_test")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .maybeSingle(),
    sb
      .from("buddy_research_missions")
      .select("id")
      .eq("deal_id", dealId)
      .eq("status", "complete")
      .order("completed_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const gateResult = missionResult.data?.id
    ? await sb
        .from("buddy_research_quality_gates")
        .select("trust_grade")
        .eq("mission_id", missionResult.data.id)
        .order("evaluated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null };

  const assumptionsStatus = assumptionsResult.data?.status ?? null;
  const documentCount = documentsResult.count ?? 0;
  const financialFactCount = factsResult.count ?? 0;
  const useOfProceedsCount = proceedsResult.count ?? 0;
  const validationStatus = validationResult.data?.overall_status ?? null;
  const researchTrustGrade = gateResult.data?.trust_grade ?? null;
  const isTestDeal = dealResult.data?.is_test === true;
  const assumptions = assumptionsResult.data as Record<string, unknown> | null;
  const confirmedRevenueStreams = Array.isArray(assumptions?.revenue_streams)
    ? assumptions.revenue_streams.length : 0;
  const managementMembers = Array.isArray(assumptions?.management_team)
    ? assumptions.management_team.length : 0;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (dealResult.error || !dealResult.data) {
    reasons.push(`Deal tenancy could not be verified: ${dealResult.error?.message ?? "deal not found"}`);
  }

  if (assumptionsResult.error) reasons.push(`Assumptions could not be checked: ${assumptionsResult.error.message}`);
  else if (assumptionsStatus !== "confirmed") reasons.push("Projection assumptions must be confirmed.");

  if (documentsResult.error) reasons.push(`Documents could not be checked: ${documentsResult.error.message}`);
  else if (documentCount < 2) reasons.push(`At least 2 uploaded source documents are required (${documentCount} found).`);

  if (factsResult.error) reasons.push(`Financial facts could not be checked: ${factsResult.error.message}`);
  else if (financialFactCount < 5) reasons.push(`At least 5 extracted financial facts are required (${financialFactCount} found).`);

  if (proceedsResult.error) reasons.push(`Use of proceeds could not be checked: ${proceedsResult.error.message}`);
  else if (useOfProceedsCount < 1) reasons.push("At least one canonical use-of-proceeds line is required.");

  if (validationResult.error) reasons.push(`Validation status could not be checked: ${validationResult.error.message}`);
  else if (!validationStatus) reasons.push("Run the AI assessment and deterministic validation before generating Final Trident.");
  else if (validationStatus === "FAIL") reasons.push("The latest deterministic validation report must not be FAIL.");

  if (missionResult.error) reasons.push(`Research status could not be checked: ${missionResult.error.message}`);
  if (gateResult.error) reasons.push(`Research trust grade could not be checked: ${gateResult.error.message}`);
  if (!missionResult.error && !gateResult.error) {
    const research = evaluateTridentResearchTrust({ trustGrade: researchTrustGrade, isTestDeal });
    reasons.push(...research.reasons);
    warnings.push(...research.warnings);
  }

  if (confirmedRevenueStreams < 1) reasons.push("At least one confirmed revenue stream is required.");
  if (managementMembers < 1) reasons.push("At least one management-team member is required.");
  if (!assumptions?.cost_assumptions) reasons.push("Confirmed cost assumptions are required.");
  if (!assumptions?.working_capital) reasons.push("Confirmed working-capital assumptions are required.");
  if (!assumptions?.loan_impact) reasons.push("Confirmed loan-impact and debt assumptions are required.");

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    evidence: {
      assumptionsStatus,
      documentCount,
      financialFactCount,
      useOfProceedsCount,
      validationStatus,
      researchTrustGrade,
      isTestDeal,
      confirmedRevenueStreams,
      managementMembers,
    },
  };
}
