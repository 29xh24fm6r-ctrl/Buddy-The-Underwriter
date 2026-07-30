import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — extracted from
 * src/app/api/deals/[dealId]/methodology/route.ts's getMethodologyPreview
 * (SPEC-B4) so the new projections-assumptions narrative generator computes
 * the exact same facts/formType/currentSlate/proposedAds the methodology
 * picker preview already shows a banker — two surfaces, one loader (Build
 * Principle #17), so they cannot drift apart on which tax-return facts or
 * which proposed debt service is "current" for a deal.
 */

import { loadDealMethodology } from "@/lib/methodology/loadDealMethodology";
import type { MethodologySlate } from "@/lib/methodology/types";

type SB = { from: (t: string) => any };

const FACT_KEYS_FOR_PROJECTION = [
  "ORDINARY_BUSINESS_INCOME",
  "INTEREST_EXPENSE",
  "DEPRECIATION",
  "AMORTIZATION",
  "SECTION_179_EXPENSE",
  "BONUS_DEPRECIATION",
  "NON_RECURRING_EXPENSE",
  "NON_RECURRING_INCOME",
  "GUARANTEED_PAYMENTS",
  "COST_OF_GOODS_SOLD",
  "OFFICER_COMPENSATION",
  "GROSS_RECEIPTS",
  "NET_INCOME",
];

export type ProjectionInputs = {
  projectable: true;
  facts: Record<string, number | null>;
  formType: string;
  currentSlate: MethodologySlate;
  proposedAds: number;
};

export type ProjectionInputsUnavailable = {
  projectable: false;
  reason: string;
};

export async function loadProjectionInputsForDeal(
  dealId: string,
  bankId: string,
  sb: SB,
): Promise<ProjectionInputs | ProjectionInputsUnavailable> {
  const { slate: currentSlate } = await loadDealMethodology(dealId, bankId);

  const { data: pricingRow } = await (sb as any)
    .from("deal_structural_pricing")
    .select("annual_debt_service_est")
    .eq("deal_id", dealId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const proposedAds = pricingRow?.annual_debt_service_est
    ? Number(pricingRow.annual_debt_service_est)
    : null;

  if (proposedAds === null || !(proposedAds > 0)) {
    return {
      projectable: false,
      reason: "No proposed annual debt service set. Projection requires loan terms.",
    };
  }

  const { data: factRows } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_period_end")
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .eq("is_superseded", false)
    .neq("resolution_status", "rejected")
    .in("fact_key", FACT_KEYS_FOR_PROJECTION)
    .order("fact_period_end", { ascending: false });

  if (!factRows || factRows.length === 0) {
    return {
      projectable: false,
      reason: "No tax-return facts yet. Upload tax returns to enable projection.",
    };
  }

  const latestPeriod = (factRows as any[])[0].fact_period_end;
  const latestFacts = (factRows as any[]).filter(
    (r: any) => r.fact_period_end === latestPeriod,
  );
  const facts: Record<string, number | null> = {};
  for (const k of FACT_KEYS_FOR_PROJECTION) {
    const row = latestFacts.find((r: any) => r.fact_key === k);
    facts[k] = row?.fact_value_num ?? null;
  }

  const formType = facts.GUARANTEED_PAYMENTS !== null ? "FORM_1065" : "FORM_1120";

  return { projectable: true, facts, formType, currentSlate, proposedAds };
}
