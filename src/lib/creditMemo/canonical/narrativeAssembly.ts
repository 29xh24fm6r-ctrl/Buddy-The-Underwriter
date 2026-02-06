import "server-only";

import { aiJson } from "@/lib/ai/openai";
import type { CanonicalCreditMemoV1 } from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import crypto from "crypto";

export type MemoNarratives = {
  executive_summary: string;
  income_analysis: string;
  property_description: string;
  borrower_background: string;
  borrower_experience: string;
  guarantor_strength: string;
};

const NARRATIVES_SCHEMA = `{
  "executive_summary": "2-3 paragraph overview: deal structure, key strengths, key risks, recommendation",
  "income_analysis": "1-2 paragraphs: income trends, NOI composition, cash flow adequacy",
  "property_description": "1 paragraph: property type, condition, location, market context",
  "borrower_background": "1 paragraph: entity structure, ownership, operating history",
  "borrower_experience": "1 paragraph: management track record, relevant experience",
  "guarantor_strength": "1 paragraph: guarantor net worth, liquidity, income adequacy"
}`;

function buildNarrativeInput(memo: CanonicalCreditMemoV1): Record<string, any> {
  return {
    deal_name: memo.header.deal_name,
    borrower_name: memo.header.borrower_name,
    loan_amount: memo.key_metrics.loan_amount.value,
    product: memo.key_metrics.product,
    rate_summary: memo.key_metrics.rate_summary,
    dscr_uw: memo.key_metrics.dscr_uw.value,
    dscr_stressed: memo.key_metrics.dscr_stressed.value,
    ltv_gross: memo.key_metrics.ltv_gross.value,
    debt_yield: memo.key_metrics.debt_yield.value,
    cap_rate: memo.key_metrics.cap_rate.value,
    stabilization: memo.key_metrics.stabilization_status,
    noi: memo.financial_analysis.noi.value,
    cash_flow: memo.financial_analysis.cash_flow_available.value,
    debt_service: memo.financial_analysis.debt_service.value,
    excess_cash_flow: memo.financial_analysis.excess_cash_flow.value,
    collateral_gross: memo.collateral.gross_value.value,
    collateral_net: memo.collateral.net_value.value,
    as_is: memo.collateral.valuation.as_is.value,
    stabilized: memo.collateral.valuation.stabilized.value,
    purpose: memo.transaction_overview.loan_request.purpose,
    term_months: memo.transaction_overview.loan_request.term_months,
    risk_factors: memo.risk_factors.map(r => r.risk),
    policy_exceptions: memo.policy_exceptions.map(p => p.exception),
    recommendation_verdict: memo.recommendation.verdict,
    recommendation_headline: memo.recommendation.headline,
    sponsors: memo.borrower_sponsor.sponsors.map(s => ({
      name: s.name,
      income: s.total_personal_income.value,
      net_worth: s.pfs_net_worth.value,
      total_assets: s.pfs_total_assets.value,
    })),
    gcf: {
      global_cash_flow: memo.global_cash_flow.global_cash_flow.value,
      global_dscr: memo.global_cash_flow.global_dscr.value,
    },
    research: memo.business_industry_analysis
      ? {
          industry_overview: memo.business_industry_analysis.industry_overview.slice(0, 500),
          competitive: memo.business_industry_analysis.competitive_positioning.slice(0, 500),
        }
      : null,
  };
}

function computeInputHash(input: Record<string, any>): string {
  const json = JSON.stringify(input, Object.keys(input).sort());
  return crypto.createHash("sha256").update(json).digest("hex").slice(0, 16);
}

export async function assembleNarratives(args: {
  memo: CanonicalCreditMemoV1;
  forceRegenerate?: boolean;
}): Promise<MemoNarratives> {
  const { memo } = args;
  const sb = supabaseAdmin();
  const input = buildNarrativeInput(memo);
  const inputHash = computeInputHash(input);

  // Check cache
  if (!args.forceRegenerate) {
    const { data: cached } = await (sb as any)
      .from("canonical_memo_narratives")
      .select("narratives")
      .eq("deal_id", memo.deal_id)
      .eq("bank_id", memo.bank_id)
      .eq("input_hash", inputHash)
      .limit(1)
      .maybeSingle();

    if (cached?.narratives) {
      return cached.narratives as MemoNarratives;
    }
  }

  const system =
    "You are a senior commercial loan underwriter at a community bank. " +
    "Write institutional-quality credit memo narratives. " +
    "Be concise, factual, and reference specific metrics. " +
    "Never speculate beyond the provided data. " +
    "Use third person ('The borrower...') and professional tone. " +
    "Every claim must trace to a number in the input.";

  const user =
    "Generate credit memo narrative sections from this structured deal data:\n\n" +
    JSON.stringify(input, null, 2);

  const res = await aiJson<MemoNarratives>({
    scope: "credit_memo_narratives",
    action: "assemble",
    system,
    user,
    jsonSchemaHint: NARRATIVES_SCHEMA,
  });

  const narratives: MemoNarratives = res.ok
    ? res.result
    : {
        executive_summary: "Narrative generation unavailable.",
        income_analysis: "Narrative generation unavailable.",
        property_description: "Narrative generation unavailable.",
        borrower_background: "Narrative generation unavailable.",
        borrower_experience: "Narrative generation unavailable.",
        guarantor_strength: "Narrative generation unavailable.",
      };

  // Cache result
  await (sb as any)
    .from("canonical_memo_narratives")
    .upsert(
      {
        deal_id: memo.deal_id,
        bank_id: memo.bank_id,
        input_hash: inputHash,
        narratives,
        model: res.ok ? (res as any).model ?? "unknown" : "failed",
        generated_at: new Date().toISOString(),
      },
      { onConflict: "deal_id,bank_id,input_hash" },
    )
    .then(() => {});

  return narratives;
}

/**
 * Overlay narratives onto a populated memo.
 * Mutates the memo in place and returns it.
 */
export function overlayNarratives(
  memo: CanonicalCreditMemoV1,
  narratives: MemoNarratives,
): CanonicalCreditMemoV1 {
  memo.executive_summary.narrative = narratives.executive_summary;
  memo.financial_analysis.income_analysis = narratives.income_analysis;
  memo.collateral.property_description = narratives.property_description;
  memo.borrower_sponsor.background = narratives.borrower_background;
  memo.borrower_sponsor.experience = narratives.borrower_experience;
  memo.borrower_sponsor.guarantor_strength = narratives.guarantor_strength;
  return memo;
}
