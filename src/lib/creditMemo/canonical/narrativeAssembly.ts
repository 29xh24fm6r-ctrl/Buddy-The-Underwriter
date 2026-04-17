import "server-only";

import { aiJson } from "@/lib/ai/openai";
import type { CanonicalCreditMemoV1, RatioAnalysisRow, RatioCategory } from "./types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import crypto from "crypto";

// Phase 89: use gemini-2.5-pro for the narrative — deep-reasoning task where
// the model must synthesize 26 ratios across 5 categories into committee prose.
const NARRATIVE_MODEL = "gemini-2.5-pro-preview-03-25";
// Pro model with thinking enabled can emit large thought traces alongside
// the answer. 8192 gives headroom for thinking + narrative output; extractResponseText
// in openai.ts filters thought parts so only the narrative lands in text.
const NARRATIVE_MAX_TOKENS = 8192;

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
  "income_analysis": "3-5 paragraphs — one per applicable ratio category (Liquidity, Leverage, Coverage, Profitability, Activity). Each paragraph names the specific ratios, cites their values, uses the Strong/Adequate/Weak framing, and notes the institutional benchmark where the ratio flags it.",
  "property_description": "1 paragraph: property type, condition, location, market context",
  "borrower_background": "1 paragraph: entity structure, ownership, operating history",
  "borrower_experience": "1 paragraph: management track record, relevant experience",
  "guarantor_strength": "1 paragraph: guarantor net worth, liquidity, income adequacy"
}`;

const FALLBACK_NARRATIVES: MemoNarratives = {
  executive_summary: "Narrative generation unavailable.",
  income_analysis: "Narrative generation unavailable.",
  property_description: "Narrative generation unavailable.",
  borrower_background: "Narrative generation unavailable.",
  borrower_experience: "Narrative generation unavailable.",
  guarantor_strength: "Narrative generation unavailable.",
};

/**
 * Phase 89: structure the ratio suite by category for the AI prompt.
 * Rows with no category are grouped under "Uncategorized" (should not occur
 * for rows produced by buildRatioAnalysisSuite).
 */
function groupRatiosByCategory(
  ratios: RatioAnalysisRow[],
): Record<string, Array<Pick<RatioAnalysisRow, "metric" | "value" | "unit" | "assessment" | "interpretation" | "benchmark_note" | "period_label">>> {
  const grouped: Record<string, any[]> = {};
  for (const r of ratios) {
    if (r.value === null || !Number.isFinite(r.value as number)) continue; // suppress nulls
    const cat = (r.category ?? "Uncategorized") as RatioCategory | "Uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({
      metric: r.metric,
      value: r.value,
      unit: r.unit,
      assessment: r.assessment ?? null,
      interpretation: r.interpretation ?? null,
      benchmark_note: r.benchmark_note ?? null,
      period_label: r.period_label,
    });
  }
  return grouped;
}

function buildNarrativeInput(memo: CanonicalCreditMemoV1): Record<string, any> {
  const ratiosByCategory = groupRatiosByCategory(memo.financial_analysis.ratio_analysis);

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
    // Phase 89: institutional ratio suite, organized by category.
    // Null ratios are already suppressed by buildRatioAnalysisSuite;
    // groupRatiosByCategory also strips any remaining nulls defensively.
    // Each category list may be empty (service businesses typically have no
    // Activity section, CRE-only deals have no Profitability section).
    ratio_suite: ratiosByCategory,
    ratio_suite_count: memo.financial_analysis.ratio_analysis.length,
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

  // Check cache — wrapped defensively in case table schema differs
  if (!args.forceRegenerate) {
    try {
      const { data: cached, error: cacheErr } = await (sb as any)
        .from("canonical_memo_narratives")
        .select("narratives")
        .eq("deal_id", memo.deal_id)
        .eq("bank_id", memo.bank_id)
        .eq("input_hash", inputHash)
        .limit(1)
        .maybeSingle();

      if (!cacheErr && cached?.narratives) {
        return cached.narratives as MemoNarratives;
      }
    } catch {
      // table may not have input_hash column — fall through to generation
    }
  }

  const system = [
    "You are a senior commercial loan underwriter at a community bank writing for an institutional loan committee.",
    "Write committee-grade credit memo narratives.",
    "",
    "HARD RULES:",
    "- Third person, professional tone ('The borrower...', 'Management...').",
    "- Every numeric claim MUST trace to a value present in the input JSON. Never invent numbers.",
    "- Never speculate beyond the data. If data is absent, omit the claim.",
    "- Do not contradict the ratio_suite assessments. If a ratio is labeled 'Weak', the narrative must name it as a weakness, not a strength.",
    "",
    "INCOME_ANALYSIS STRUCTURE (Phase 89):",
    "The income_analysis section is the centerpiece. Write one paragraph per APPLICABLE category present in ratio_suite.",
    "Categories and their order: Liquidity, Leverage, Coverage, Profitability, Activity.",
    "- Only write a paragraph for a category if ratio_suite[category] is non-empty. Skip categories that are missing.",
    "- For each paragraph: name the category, cite the specific ratios by label + value + unit, use the assessment labels (Strong/Adequate/Weak) verbatim, and reference the benchmark_note where it materially frames committee interpretation (especially for DSCR at the 1.25x institutional minimum, Debt/EBITDA ceiling, FCCR covenant line).",
    "- Example sentence pattern: 'Liquidity is adequate: Current Ratio of 1.42x and Quick Ratio of 0.88x both sit above the 0.5x institutional floor, with Working Capital of $312K providing operating cushion.'",
    "- Do not just recite values — integrate assessment + benchmark into one committee-grade paragraph per category.",
    "- Close the section with a brief synthesis paragraph tying liquidity, leverage, and coverage to the loan's repayment capacity.",
  ].join("\n");

  const user =
    "Generate credit memo narrative sections from this structured deal data. " +
    "Pay particular attention to ratio_suite — it is categorized and each ratio carries a precomputed assessment + benchmark_note you must use:\n\n" +
    JSON.stringify(input, null, 2);

  // Wrap aiJson in try/catch — if it throws (network, auth, quota), return
  // the fallback narratives rather than propagating a 500 to the route.
  let narratives: MemoNarratives;
  try {
    const res = await aiJson<MemoNarratives>({
      scope: "credit_memo_narratives",
      action: "assemble",
      system,
      user,
      jsonSchemaHint: NARRATIVES_SCHEMA,
      model: NARRATIVE_MODEL,
      maxOutputTokens: NARRATIVE_MAX_TOKENS,
    });
    narratives = res.ok ? res.result : FALLBACK_NARRATIVES;
  } catch (e) {
    console.error("[assembleNarratives] aiJson threw:", e);
    narratives = FALLBACK_NARRATIVES;
  }

  // Cache result — fire-and-forget, failure is non-fatal
  try {
    await (sb as any)
      .from("canonical_memo_narratives")
      .upsert(
        {
          deal_id: memo.deal_id,
          bank_id: memo.bank_id,
          input_hash: inputHash,
          narratives,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "deal_id,bank_id,input_hash" },
      );
  } catch {
    // non-fatal
  }

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
