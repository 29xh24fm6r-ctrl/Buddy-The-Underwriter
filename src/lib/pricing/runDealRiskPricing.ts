import "server-only";

import { computePricing } from "@/lib/pricing/compute";

/**
 * SINGLE CANONICAL ADAPTER:
 * deal row -> risk-based pricing model -> UI-friendly output
 */

type Deal = {
  id: string;
  risk_score: number | null;
  requested_loan_amount: number | null;
  project_cost: number | null;
  property_value: number | null;
  noi: number | null;
  dscr: number | null;
  ltv: number | null;
};

export type DealPricingExplain = {
  label: string;
  detail: string;
  deltaBps?: number;
};

export type DealPricingOutput = {
  inputs: Record<string, unknown>;
  risk: {
    score: number;
    tier: "A" | "B" | "C" | "D" | "E";
  };
  decision: "approve" | "review" | "decline";
  quote: {
    baseRate: number;
    spreadBps: number;
    apr: number;
    maxLoanAmount: number | null;
  };
  explain: DealPricingExplain[];
};

type PricingModelInput = {
  dealId: string;
  productType: string;
  riskGrade: string;
  termMonths: number;
  indexName: string;
  indexRateBps: number;
};

function mapDealToModelInputs(deal: Deal): PricingModelInput {
  const riskScore = deal.risk_score ?? 0;
  const riskGrade = scoreToRiskGrade(riskScore);

  return {
    dealId: deal.id,
    productType: "SBA_7A",
    riskGrade,
    termMonths: 120,
    indexName: "SOFR",
    indexRateBps: 500,
  };
}

export async function runDealRiskPricing(deal: Deal): Promise<DealPricingOutput> {
  const modelInput = mapDealToModelInputs(deal);

  const inputs = {
    dealId: deal.id,
    risk_score: deal.risk_score,
    requested_loan_amount: deal.requested_loan_amount,
    project_cost: deal.project_cost,
    property_value: deal.property_value,
    noi: deal.noi,
    dscr: deal.dscr,
    ltv: deal.ltv,
    pricing_model: modelInput,
  };

  const missing: string[] = [];
  if (deal.noi == null) missing.push("noi");
  if (deal.dscr == null) missing.push("dscr");
  if (deal.ltv == null) missing.push("ltv");
  if (deal.risk_score == null) missing.push("risk_score");

  if (missing.length) {
    return {
      inputs,
      risk: { score: deal.risk_score ?? 0, tier: "E" },
      decision: "review",
      quote: { baseRate: 0, spreadBps: 0, apr: 0, maxLoanAmount: null },
      explain: [
        {
          label: "Missing inputs",
          detail: `Cannot quote until these fields exist on deals: ${missing.join(", ")}`,
        },
      ],
    };
  }

  try {
    const result = await computePricing(modelInput);
    const baseRate = modelInput.indexRateBps / 100;
    const spreadBps = result.baseSpreadBps + result.overrideSpreadBps;
    const apr = result.finalRateBps / 100;
    const riskScore = deal.risk_score ?? 0;
    const riskTier = scoreToTier(riskScore);
    const decision =
      riskScore >= 90 ? "decline" :
      riskScore >= 80 ? "review" :
      "approve";

    const explain: DealPricingExplain[] = [
      { label: "Pricing policy", detail: result.explain.policyName },
      { label: "Grid row", detail: result.explain.gridRow },
    ];

    if (result.explain.override) {
      explain.push({ label: "Override", detail: result.explain.override });
    }

    return {
      inputs,
      risk: { score: riskScore, tier: riskTier },
      decision,
      quote: {
        baseRate: Number(baseRate.toFixed(3)),
        spreadBps,
        apr: Number(apr.toFixed(3)),
        maxLoanAmount: null,
      },
      explain,
    };
  } catch (err: any) {
    return {
      inputs,
      risk: { score: deal.risk_score ?? 0, tier: scoreToTier(deal.risk_score ?? 0) },
      decision: "review",
      quote: { baseRate: 0, spreadBps: 0, apr: 0, maxLoanAmount: null },
      explain: [
        {
          label: "Pricing error",
          detail: err?.message ?? "Pricing model failed; unable to quote.",
        },
      ],
    };
  }
}

function scoreToTier(score: number): DealPricingOutput["risk"]["tier"] {
  if (score < 35) return "A";
  if (score < 50) return "B";
  if (score < 65) return "C";
  if (score < 80) return "D";
  return "E";
}

function scoreToRiskGrade(score: number): string {
  const clamped = Math.max(1, Math.min(10, Math.ceil(score / 10)));
  return String(clamped);
}
