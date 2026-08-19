import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type TridentReadiness = {
  ok: boolean;
  reasons: string[];
  evidence: {
    assumptionsStatus: string | null;
    documentCount: number;
    financialFactCount: number;
    useOfProceedsCount: number;
    validationStatus: string | null;
    confirmedRevenueStreams: number;
    managementMembers: number;
  };
};

/**
 * Quality-lab admission gate. This is intentionally stricter than the core
 * renderer: a PDF that can be produced from defaults is not a useful Golden
 * Trident quality test.
 */
export async function getTridentReadiness(args: {
  sb: SupabaseClient;
  dealId: string;
  bankId: string;
}): Promise<TridentReadiness> {
  const { sb, dealId, bankId } = args;
  const [assumptionsResult, documentsResult, factsResult, proceedsResult, validationResult] = await Promise.all([
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
  ]);

  const assumptionsStatus = assumptionsResult.data?.status ?? null;
  const documentCount = documentsResult.count ?? 0;
  const financialFactCount = factsResult.count ?? 0;
  const useOfProceedsCount = proceedsResult.count ?? 0;
  const validationStatus = validationResult.data?.overall_status ?? null;
  const assumptions = assumptionsResult.data as Record<string, unknown> | null;
  const confirmedRevenueStreams = Array.isArray(assumptions?.revenue_streams)
    ? assumptions.revenue_streams.length : 0;
  const managementMembers = Array.isArray(assumptions?.management_team)
    ? assumptions.management_team.length : 0;
  const reasons: string[] = [];

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

  if (confirmedRevenueStreams < 1) reasons.push("At least one confirmed revenue stream is required.");
  if (managementMembers < 1) reasons.push("At least one management-team member is required.");
  if (!assumptions?.cost_assumptions) reasons.push("Confirmed cost assumptions are required.");
  if (!assumptions?.working_capital) reasons.push("Confirmed working-capital assumptions are required.");
  if (!assumptions?.loan_impact) reasons.push("Confirmed loan-impact and debt assumptions are required.");

  return {
    ok: reasons.length === 0,
    reasons,
    evidence: {
      assumptionsStatus,
      documentCount,
      financialFactCount,
      useOfProceedsCount,
      validationStatus,
      confirmedRevenueStreams,
      managementMembers,
    },
  };
}
