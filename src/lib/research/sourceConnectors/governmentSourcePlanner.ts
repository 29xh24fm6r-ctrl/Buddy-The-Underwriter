/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1 — Phase 6
 *
 * BLS / Census / FRED / NAICS government-data source CANDIDATE planner. Does NOT
 * pull APIs — it emits explicit, safe source candidates (not arbitrary web
 * search) for the industry/market sections, derived from NAICS + geography +
 * loan type. citysdk/census lesson: NAICS/geography is handled as explicit
 * candidates/plans. Pure module.
 */

import type { SourceCandidate } from "./types";

export type GovernmentSourcePlanInput = {
  naicsCode?: string | null;
  naicsDescription?: string | null;
  hqCity?: string | null;
  hqState?: string | null;
  loanType?: string | null;
};

const INDUSTRY = ["Industry Overview"];
const MARKET = ["Market Intelligence"];

export function planGovernmentSources(input: GovernmentSourcePlanInput): SourceCandidate[] {
  const naics = (input.naicsCode ?? "").trim();
  const naicsValid = /^\d{2,6}$/.test(naics) && naics !== "999999";
  const desc = (input.naicsDescription ?? "").trim();
  const geo = [input.hqCity, input.hqState].filter((v) => (v ?? "").trim()).join(", ");
  const naicsLabel = naicsValid ? `NAICS ${naics}${desc ? ` (${desc})` : ""}` : (desc || "the industry");

  const candidates: SourceCandidate[] = [];

  // BLS — industry employment / wages.
  candidates.push({
    label: `BLS industry employment & wages — ${naicsLabel}`,
    source_url: naicsValid
      ? `https://data.bls.gov/cew/apps/data_views/data_views.htm#tab=Tables`
      : "https://www.bls.gov/oes/",
    source_type: "government_data",
    recommended_for_sections: INDUSTRY,
    requirement_keys: ["industry_source"],
    rationale: `Bureau of Labor Statistics employment, wage, and establishment counts for ${naicsLabel} to ground the industry analysis.`,
    limitations: [
      naicsValid ? "Manual NAICS lookup in the BLS data viewer; attach the result." : "No valid NAICS on file — confirm the NAICS code first.",
    ],
  });

  // Census — Economic Census / County Business Patterns.
  candidates.push({
    label: `Census County Business Patterns / Economic Census — ${naicsLabel}`,
    source_url: naicsValid
      ? `https://data.census.gov/cedsci/all?q=${encodeURIComponent(`NAICS ${naics}`)}`
      : "https://data.census.gov/",
    source_type: "government_data",
    recommended_for_sections: INDUSTRY,
    requirement_keys: ["industry_source"],
    rationale: `U.S. Census establishment counts / receipts for ${naicsLabel} as an institutional industry-size source.`,
    limitations: ["Manual lookup; verify the NAICS vintage and geography level."],
  });

  // FRED — macro / rate / regional context.
  candidates.push({
    label: "FRED macro & rate context (PRIME, regional employment)",
    source_url: "https://fred.stlouisfed.org/",
    source_type: "government_data",
    recommended_for_sections: MARKET,
    requirement_keys: ["market_geography_source"],
    rationale: `Federal Reserve (FRED) macro / interest-rate / regional series for repayment and market context${input.loanType ? ` (relevant to a ${input.loanType} facility)` : ""}.`,
    limitations: ["Select the specific series; FRED is context, not a borrower-specific source."],
  });

  // Census geography — local market (only when geography known).
  if (geo) {
    candidates.push({
      label: `Census QuickFacts — ${geo}`,
      source_url: `https://www.census.gov/quickfacts/`,
      source_type: "government_data",
      recommended_for_sections: MARKET,
      requirement_keys: ["market_geography_source"],
      rationale: `Local demographic / economic context for ${geo} to support the market analysis.`,
      limitations: ["Manual QuickFacts lookup for the specific place; attach the result."],
    });
  }

  return candidates;
}
