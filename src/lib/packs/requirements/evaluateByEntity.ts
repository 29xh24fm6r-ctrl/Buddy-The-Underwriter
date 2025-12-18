// src/lib/packs/requirements/evaluateByEntity.ts
// Entity-aware requirements evaluation

import type { PackIndex } from "@/lib/deals/pack/buildPackIndex";
import type { DealEntity } from "@/lib/entities/types";
import type { CoverageSummary, PackRequirement, RequirementResult } from "./types";
import { evaluateRequirements, summarizeCoverage } from "./evaluate";

export type EntityCoverageSummary = {
  entity_id: string;
  entity_name: string;
  entity_kind: string;
  results: RequirementResult[];
  coverage: CoverageSummary;
};

export type GroupCoverageSummary = {
  scope: 'GROUP';
  overall_results: RequirementResult[];
  overall_coverage: CoverageSummary;
  entity_summaries: EntityCoverageSummary[];
  total_requirements: number;
  total_met: number;
  total_partial: number;
  total_missing: number;
};

/**
 * Evaluate requirements for a single entity
 */
export function evaluateEntityRequirements(
  packIndex: PackIndex | null,
  requirements: PackRequirement[],
  entityId: string,
  entityName: string,
  entityKind: string
): EntityCoverageSummary {
  const results = evaluateRequirements(packIndex, requirements);
  const coverage = summarizeCoverage(results);
  
  return {
    entity_id: entityId,
    entity_name: entityName,
    entity_kind: entityKind,
    results,
    coverage,
  };
}

/**
 * Evaluate requirements across all entities (GROUP view)
 */
export function evaluateGroupRequirements(
  allJobs: any[], // All jobs with entity_id populated
  entities: DealEntity[],
  requirements: PackRequirement[]
): GroupCoverageSummary {
  const { buildPackIndex } = require('@/lib/deals/pack/buildPackIndex');
  
  // Build pack index for entire group (no entity filter)
  const groupPackIndex = buildPackIndex({
    jobs: allJobs,
    entityFilter: null, // null = show all
  });
  
  const overallResults = evaluateRequirements(groupPackIndex, requirements);
  const overallCoverage = summarizeCoverage(overallResults);
  
  // Build per-entity summaries
  const entitySummaries: EntityCoverageSummary[] = [];
  
  for (const entity of entities) {
    if (entity.entity_kind === 'GROUP') continue; // Skip GROUP entity itself
    
    // Build pack index filtered to this entity
    const entityPackIndex = buildPackIndex({
      jobs: allJobs,
      entityFilter: entity.id,
    });
    
    const entityResults = evaluateRequirements(entityPackIndex, requirements);
    const entityCoverage = summarizeCoverage(entityResults);
    
    entitySummaries.push({
      entity_id: entity.id,
      entity_name: entity.name,
      entity_kind: entity.entity_kind,
      results: entityResults,
      coverage: entityCoverage,
    });
  }
  
  // Aggregate totals
  let totalMet = 0;
  let totalPartial = 0;
  let totalMissing = 0;
  
  for (const summary of entitySummaries) {
    totalMet += summary.coverage.satisfied;
    totalPartial += summary.coverage.partial;
    totalMissing += summary.coverage.missing;
  }
  
  return {
    scope: 'GROUP',
    overall_results: overallResults,
    overall_coverage: overallCoverage,
    entity_summaries: entitySummaries,
    total_requirements: requirements.length * (entities.length - 1), // -1 for GROUP
    total_met: totalMet,
    total_partial: totalPartial,
    total_missing: totalMissing,
  };
}

/**
 * Get entity-specific missing documents summary
 */
export function getEntityMissingDocsSummary(
  entitySummaries: EntityCoverageSummary[]
): Array<{
  entity_name: string;
  missing_items: string[];
}> {
  return entitySummaries
    .map(summary => ({
      entity_name: summary.entity_name,
      missing_items: summary.results
        .filter((r: RequirementResult) => r.status === 'MISSING')
        .map((r: RequirementResult) => r.requirement.label),
    }))
    .filter(item => item.missing_items.length > 0);
}
