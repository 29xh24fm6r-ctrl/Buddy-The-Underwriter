import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type TridentReadiness = {
  ok: boolean;
  reasons: string[];
  evidence: {
    assumptionsStatus: string | null;
    documentCount: number;
    financialFactCount: number;
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
  const [assumptionsResult, documentsResult, factsResult] = await Promise.all([
    sb
      .from("buddy_sba_assumptions")
      .select("status")
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
  ]);

  const assumptionsStatus = assumptionsResult.data?.status ?? null;
  const documentCount = documentsResult.count ?? 0;
  const financialFactCount = factsResult.count ?? 0;
  const reasons: string[] = [];

  if (assumptionsResult.error) reasons.push(`Assumptions could not be checked: ${assumptionsResult.error.message}`);
  else if (assumptionsStatus !== "confirmed") reasons.push("Projection assumptions must be confirmed.");

  if (documentsResult.error) reasons.push(`Documents could not be checked: ${documentsResult.error.message}`);
  else if (documentCount < 2) reasons.push(`At least 2 uploaded source documents are required (${documentCount} found).`);

  if (factsResult.error) reasons.push(`Financial facts could not be checked: ${factsResult.error.message}`);
  else if (financialFactCount < 5) reasons.push(`At least 5 extracted financial facts are required (${financialFactCount} found).`);

  return {
    ok: reasons.length === 0,
    reasons,
    evidence: { assumptionsStatus, documentCount, financialFactCount },
  };
}
