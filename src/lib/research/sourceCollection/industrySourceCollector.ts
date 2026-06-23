/**
 * SPEC-BIE-ACTIVE-SOURCE-COLLECTION-PR-B
 *
 * Deterministic Industry Validation source collector. Given a NAICS + geography
 * it returns the official government-data source descriptor to fetch (Census
 * first, BLS fallback) — a real, deterministic URL built by the existing
 * government-source planner. Pure: no fetch, no AI, no fabricated URLs/citations.
 * Returns null when there is no usable NAICS to ground an institutional source.
 */

import { planGovernmentSources } from "@/lib/research/sourceConnectors/governmentSourcePlanner";
import type { SourceConnectorKind } from "@/lib/research/sourceConnectors/types";

export type IndustrySourceDescriptor = {
  connectorKind: SourceConnectorKind;
  sourceType: string;
  sourceUrl: string;
  label: string;
  note: string;
  candidateMetadata: Record<string, unknown>;
};

export type IndustryCollectorInput = {
  naicsCode?: string | null;
  naicsDescription?: string | null;
  hqCity?: string | null;
  hqState?: string | null;
};

export function buildIndustrySourceDescriptor(input: IndustryCollectorInput): IndustrySourceDescriptor | null {
  const naics = (input.naicsCode ?? "").trim();
  if (!/^\d{2,6}$/.test(naics) || naics === "999999") return null;

  const candidates = planGovernmentSources({
    naicsCode: naics,
    naicsDescription: input.naicsDescription ?? null,
    hqCity: input.hqCity ?? null,
    hqState: input.hqState ?? null,
  });

  // Prefer the Census Economic Census / CBP candidate (institutional industry
  // size), else fall back to the first BLS government candidate.
  const census = candidates.find((c) => /census/i.test(c.label) && /Economic Census|Business Patterns/i.test(c.label));
  const chosen = census ?? candidates.find((c) => c.source_type === "government_data") ?? null;
  if (!chosen || !chosen.source_url) return null;

  return {
    connectorKind: "trade_or_market_source",
    sourceType: "government_data",
    sourceUrl: chosen.source_url,
    label: chosen.label,
    note: `Independent industry source for NAICS ${naics}${input.naicsDescription ? ` — ${input.naicsDescription}` : ""}. ${chosen.rationale}`,
    candidateMetadata: {
      decision_area: "Industry Validation",
      naics_code: naics,
      naics_description: input.naicsDescription ?? null,
      idempotency_key: `industry_validation:naics:${naics}`,
      source_family: "government_industry_data",
      // Collected source requires analyst review; never committee-grade by fetch.
      review_required: true,
      requested_evidence_class: "official_supported",
    },
  };
}
