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
// Phase 92: Pro + thinking + 5-8KB structured input typically takes 30-60s.
// Route-level maxDuration is 60s; keep 5s of margin. The default 20s
// AI_TIMEOUT_MS is far too aggressive for this call and was silently
// failing the generation to the FALLBACK_NARRATIVES path.
const NARRATIVE_TIMEOUT_MS = 55_000;

export type MemoNarratives = {
  executive_summary: string;
  income_analysis: string;
  /** Phase 92: new section — stress test synthesis. Overlayed onto
   *  financial_analysis.projection_feasibility. */
  repayment_analysis: string;
  property_description: string;
  borrower_background: string;
  borrower_experience: string;
  guarantor_strength: string;
};

const NARRATIVES_SCHEMA = `{
  "executive_summary": "2-3 paragraphs: lead with verdict + DSCR, then deal structure, then key risks. Committee should reach a preliminary judgment from this section alone.",
  "income_analysis": "One paragraph per applicable ratio category (Liquidity/Leverage/Coverage/Profitability/Activity). Each paragraph names borrower, cites specific ratio values with units, uses Strong/Adequate/Weak labels, references benchmarks. Coverage paragraph must state DSCR in dollars and the revenue cushion % from stress testing. Close with synthesis paragraph tying Five Cs composite to repayment thesis. Minimum 4 paragraphs for a deal with full data.",
  "repayment_analysis": "1-2 paragraphs synthesizing the stress test results. State the specific revenue decline % the business can absorb before breaching 1.25x DSCR, cite the breakeven revenue figure, name the worst-case stress scenario and its DSCR outcome. Connect to the proposed covenant structure.",
  "property_description": "1 paragraph: collateral type, condition, location, market context, advance rate applied.",
  "borrower_background": "1 paragraph: legal entity, ownership structure with percentages, operating history, geography.",
  "borrower_experience": "1 paragraph: management track record, relevant industry experience, how they manage seasonal/cyclical risk.",
  "guarantor_strength": "1 paragraph: guarantor net worth vs loan amount, liquid assets, monthly income vs proposed debt service, secondary repayment adequacy."
}`;

const FALLBACK_NARRATIVES: MemoNarratives = {
  executive_summary: "Narrative generation unavailable.",
  income_analysis: "Narrative generation unavailable.",
  repayment_analysis: "Narrative generation unavailable.",
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

  // Phase 92: stress_testing and qualitative_assessment live at the TOP level
  // of CanonicalCreditMemoV1 (per Phase 90 types), not under financial_analysis.
  const stress = memo.stress_testing;
  const qa = memo.qualitative_assessment;

  return {
    // ── Header / deal identity ──────────────────────────────────────────
    deal_name: memo.header.deal_name,
    borrower_name: memo.header.borrower_name,

    // ── Loan request ────────────────────────────────────────────────────
    loan_amount: memo.key_metrics.loan_amount.value,
    product: memo.key_metrics.product,
    rate_summary: memo.key_metrics.rate_summary,
    purpose: memo.transaction_overview.loan_request.purpose,
    term_months: memo.transaction_overview.loan_request.term_months,

    // ── Key coverage + CRE metrics ──────────────────────────────────────
    dscr_uw: memo.key_metrics.dscr_uw.value,
    dscr_stressed: memo.key_metrics.dscr_stressed.value,
    ltv_gross: memo.key_metrics.ltv_gross.value,
    debt_yield: memo.key_metrics.debt_yield.value,
    cap_rate: memo.key_metrics.cap_rate.value,
    stabilization: memo.key_metrics.stabilization_status,

    // ── Cash flow / DS base ─────────────────────────────────────────────
    noi: memo.financial_analysis.noi.value,
    cash_flow: memo.financial_analysis.cash_flow_available.value,
    debt_service: memo.financial_analysis.debt_service.value,
    excess_cash_flow: memo.financial_analysis.excess_cash_flow.value,

    // ── Phase 92: top-level P&L figures in dollars ──────────────────────
    revenue: memo.financial_analysis.revenue.value,
    ebitda: memo.financial_analysis.ebitda.value,
    net_income: memo.financial_analysis.net_income.value,

    // ── Phase 92: risk grade + covenant rationale ───────────────────────
    risk_grade: memo.recommendation.risk_grade,
    covenant_rationale: memo.covenant_package?.rationale ?? null,

    // ── Collateral ──────────────────────────────────────────────────────
    collateral_gross: memo.collateral.gross_value.value,
    collateral_net: memo.collateral.net_value.value,
    as_is: memo.collateral.valuation.as_is.value,
    stabilized: memo.collateral.valuation.stabilized.value,

    // ── Risk + verdict ──────────────────────────────────────────────────
    risk_factors: memo.risk_factors.map((r) => r.risk),
    policy_exceptions: memo.policy_exceptions.map((p) => p.exception),
    recommendation_verdict: memo.recommendation.verdict,
    recommendation_headline: memo.recommendation.headline,

    // ── Sponsors / guarantor pool ───────────────────────────────────────
    sponsors: memo.borrower_sponsor.sponsors.map((s) => ({
      name: s.name,
      income: s.total_personal_income.value,
      net_worth: s.pfs_net_worth.value,
      total_assets: s.pfs_total_assets.value,
    })),

    // ── Global cash flow ────────────────────────────────────────────────
    gcf: {
      global_cash_flow: memo.global_cash_flow.global_cash_flow.value,
      global_dscr: memo.global_cash_flow.global_dscr.value,
    },

    // ── Ratio suite (Phase 89) ──────────────────────────────────────────
    ratio_suite: ratiosByCategory,
    ratio_suite_count: memo.financial_analysis.ratio_analysis.length,

    // ── Phase 92 (a): stress testing synthesis inputs ───────────────────
    // Phase 90A output lives at memo.stress_testing (top-level), not nested.
    stress: stress
      ? {
          narrative: stress.narrative,
          revenue_cushion_pct: stress.revenue_cushion_pct,
          breakeven_revenue_1x: stress.breakeven_revenue_1x,
          breakeven_ebitda_125x: stress.breakeven_ebitda_125x,
          worst_case_dscr: stress.worst_case_dscr,
          baseline_dscr: stress.baseline_dscr,
          scenarios: stress.scenarios.map((s) => ({
            label: s.label,
            stressed_dscr: s.stressed_dscr,
            assessment: s.assessment,
          })),
        }
      : null,

    // ── Phase 92 (b): qualitative assessment (Five Cs) ──────────────────
    qualitative: qa
      ? {
          composite_label: qa.composite_label,
          composite_score: qa.composite_score,
          character: { score: qa.character.score, label: qa.character.label, basis: qa.character.basis },
          capital: { score: qa.capital.score, label: qa.capital.label },
          conditions: { score: qa.conditions.score, label: qa.conditions.label },
          management: { score: qa.management.score, label: qa.management.label },
          business_model: { score: qa.business_model.score, label: qa.business_model.label },
          key_concerns: qa.key_concerns,
          key_strengths: qa.key_strengths,
        }
      : null,

    // ── Phase 92 (c): multi-year trend ──────────────────────────────────
    // Lets the AI reference revenue / CFA / DSCR trajectory across periods.
    financial_trend: memo.financial_analysis.debt_coverage_table.map((row) => ({
      label: row.label,
      revenue: row.revenue,
      cash_flow_available: row.cash_flow_available,
      dscr: row.dscr,
    })),

    // ── Phase 92 (d): business context from overrides ───────────────────
    business_context: {
      seasonality: memo.business_summary.seasonality,
      revenue_mix: memo.business_summary.revenue_mix,
      geography: memo.business_summary.geography,
      years_in_operation: memo.business_summary.years_in_operation,
    },

    // ── Research excerpt ────────────────────────────────────────────────
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

  // Check cache — wrapped defensively in case table schema differs.
  // Phase 92: the input hash now incorporates stress/qualitative/trend
  // fields, so pre-92 cache rows miss automatically and regenerate.
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

  // ── Phase 92: committee-grade prompt rewrite ───────────────────────────
  const system = [
    "You are a senior commercial loan underwriter at an FDIC-supervised community bank.",
    "You are writing for a credit committee of experienced bankers who will approve or decline this loan. They will read your narrative in 4 minutes. Make every sentence count.",
    "",
    "THE STANDARD YOUR NARRATIVE MUST MEET:",
    "Every section must pass this test: if a committee member reads only this section, they must know (1) the borrower by name, (2) the specific numeric value being discussed, and (3) what that value means for whether this loan gets repaid.",
    "Generic language like \"strong profitability\" or \"adequate liquidity\" without the specific dollar amount or ratio value FAILS this test.",
    "",
    "ABSOLUTE RULES — violating any of these is a failure:",
    "1. Always use the borrower's name, never \"the borrower\" or \"the company\" alone.",
    "2. Every ratio mentioned MUST include its value: not \"strong DSCR\" but \"DSCR of 1.42x\".",
    "3. Every dollar amount must be specific: not \"substantial revenue\" but \"$1.36M in revenue\".",
    "4. Never contradict the ratio_suite assessments — if a ratio is labeled Weak, you must name it as a weakness with its value.",
    "5. Never use the words \"Pending\", \"N/A\", or \"unavailable\". If data is absent, omit.",
    "6. Never invent numbers. Every claim must trace to a value in the input JSON.",
    "7. Connect every metric to repayment capacity. \"DSCR of 1.42x\" without \"generating $X above the $Y debt service requirement\" is incomplete.",
    "",
    "INCOME_ANALYSIS — THIS IS THE CENTERPIECE OF THE MEMO:",
    "Write one substantive paragraph per applicable ratio category from ratio_suite.",
    "Categories in order: Liquidity, Leverage, Coverage, Profitability, Activity.",
    "Skip empty categories (no data = no paragraph).",
    "",
    "For each paragraph:",
    "- Open by naming the category and its overall assessment",
    "- Name each ratio in the category with its exact value and unit",
    "- Use the assessment label (Strong/Adequate/Weak) verbatim for each ratio",
    "- Reference the benchmark_note where it materially frames committee judgment (especially DSCR at 1.25x institutional minimum, Debt/EBITDA ceiling, FCCR)",
    "- Connect to repayment capacity explicitly",
    "",
    "Required: Coverage paragraph MUST include:",
    "- DSCR value AND what it means in dollars (CFA vs ADS, and the dollar cushion)",
    "- Stressed DSCR and the specific rate shock scenario",
    "- Stress test result: revenue cushion % and breakeven revenue at 1.25x",
    "  Example sentence: \"[Borrower] can sustain a [X]% revenue decline before DSCR falls below the 1.25x institutional floor, implying a breakeven revenue of $[X].\"",
    "",
    "Close income_analysis with a synthesis paragraph that connects the Five Cs composite score (if available) to the overall repayment thesis.",
    "",
    "REPAYMENT_ANALYSIS (new section):",
    "1-2 paragraphs synthesizing the stress test results. State the specific revenue decline % the business can absorb before breaching 1.25x DSCR, cite the breakeven revenue figure, name the worst-case stress scenario and its DSCR outcome. Connect to the proposed covenant structure if covenant_rationale is present.",
    "",
    "EXECUTIVE_SUMMARY:",
    "Lead with the verdict and the most important number.",
    "First sentence format: \"[Borrower name] is requesting $[amount] for [purpose]. The deal [presents as approve/caution/decline] at [DSCR]x coverage...\"",
    "2-3 paragraphs. Committee should be able to make a preliminary judgment after reading this alone.",
    "",
    "BORROWER_BACKGROUND:",
    "Name the principals, their ownership percentages, years in operation, entity structure. Connect their track record to their ability to operate the collateral and service this debt.",
    "",
    "BORROWER_EXPERIENCE:",
    "Name management's specific relevant experience. For seasonal businesses, address how management has historically managed the off-season cash gap.",
    "",
    "GUARANTOR_STRENGTH:",
    "Net worth vs loan amount ratio. Liquid assets as secondary repayment source. State clearly whether guarantor liquidity alone could service 12 months of debt service in a distress scenario.",
  ].join("\n");

  const user =
    "Generate credit memo narrative sections from this structured deal data. " +
    "Pay particular attention to ratio_suite (categorized, each ratio precomputed with assessment + benchmark_note you must use), " +
    "stress (precomputed breakeven values for the repayment synthesis), and qualitative (Five Cs scores for the closing thesis):\n\n" +
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
      timeoutMs: NARRATIVE_TIMEOUT_MS,
    });
    if (!res.ok) {
      // Phase 92: surface aiJson failures to Vercel logs. Previously the
      // failure collapsed silently into FALLBACK_NARRATIVES with no signal.
      console.error(
        "[assembleNarratives] aiJson failed:",
        res.error,
        "model:", res.model,
        "rawText:", res.rawText?.slice(0, 300),
      );
    }
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
 *
 * Phase 92: new repayment_analysis section overlays onto
 * financial_analysis.projection_feasibility. Backward compatible — if the
 * AI returns an empty/unavailable string, we do NOT overwrite any existing
 * value already set on the memo (e.g. from an earlier narrative run or
 * default template text).
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

  // Phase 92: overlay repayment_analysis onto projection_feasibility.
  // Preserve existing value when the new content is empty or is the
  // "unavailable" fallback — we don't want to clobber a previously
  // populated synthesis with a failed generation.
  const ra = (narratives as Partial<MemoNarratives>).repayment_analysis;
  if (typeof ra === "string") {
    const trimmed = ra.trim();
    const isUnavailable = /^narrative generation unavailable\.?$/i.test(trimmed);
    if (trimmed.length > 0 && !isUnavailable) {
      memo.financial_analysis.projection_feasibility = ra;
    }
  }

  return memo;
}
