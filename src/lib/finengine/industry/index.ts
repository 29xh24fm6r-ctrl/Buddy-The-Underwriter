/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 6: Industry Intelligence Engine.
 *
 * Barrel + a convenience aggregator that resolves a NAICS code into the full
 * sector intelligence bundle (definition + risk + benchmarks + stress + covenant
 * guidance). Product analyses may optionally consume this — it never mutates
 * anything and never writes.
 */

export * from "@/lib/finengine/industry/industryRegistry";
export * from "@/lib/finengine/industry/industryRiskProfiles";
export * from "@/lib/finengine/industry/industryBenchmarks";
export * from "@/lib/finengine/industry/industryStressAssumptions";
export * from "@/lib/finengine/industry/industryCovenantGuidance";

import {
  resolveSectorFromNaics,
  getIndustryDefinition,
  type IndustrySector,
  type IndustryDefinition,
} from "@/lib/finengine/industry/industryRegistry";
import { riskProfileFor, type IndustryRiskProfile } from "@/lib/finengine/industry/industryRiskProfiles";
import { benchmarkBandsFor, type IndustryBenchmark } from "@/lib/finengine/industry/industryBenchmarks";
import { stressAssumptionsFor, type IndustryStressAssumptions } from "@/lib/finengine/industry/industryStressAssumptions";
import { covenantGuidanceFor, type IndustryCovenantGuidance } from "@/lib/finengine/industry/industryCovenantGuidance";

export type IndustryIntelligence = {
  sector: IndustrySector;
  definition: IndustryDefinition;
  risk: IndustryRiskProfile;
  benchmarks: IndustryBenchmark;
  stress: IndustryStressAssumptions;
  covenants: IndustryCovenantGuidance;
};

export function industryIntelligenceForSector(sector: IndustrySector): IndustryIntelligence {
  return {
    sector,
    definition: getIndustryDefinition(sector),
    risk: riskProfileFor(sector),
    benchmarks: benchmarkBandsFor(sector),
    stress: stressAssumptionsFor(sector),
    covenants: covenantGuidanceFor(sector),
  };
}

/** Resolve full sector intelligence from a NAICS code. Null if sector unknown. */
export function resolveIndustryIntelligence(naics: string | null | undefined): IndustryIntelligence | null {
  const sector = resolveSectorFromNaics(naics);
  return sector ? industryIntelligenceForSector(sector) : null;
}
