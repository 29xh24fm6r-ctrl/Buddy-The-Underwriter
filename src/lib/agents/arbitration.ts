/**
 * SBA God Mode: Arbitration Reconciliation Engine
 * 
 * Resolves conflicts between agent claims using deterministic rules R0-R5.
 * Produces arbitration decisions with full provenance and dissent tracking.
 */

import type { NormalizedClaim } from './claim-normalization';

/**
 * Conflict set - group of claims with same hash
 */
export interface ClaimConflictSet {
  claim_hash: string;
  topic: string;
  predicate: string;
  timeframe?: string;
  unit?: string;
  claims: NormalizedClaim[];
  num_agents: number;
  has_blocker: boolean;
}

/**
 * Arbitration decision
 */
export interface ArbitrationDecision {
  claim_hash: string;
  chosen_value_json: Record<string, any> | null;
  chosen_claim_id?: string;
  decision_status: 'unresolved' | 'chosen' | 'deferred' | 'human_override';
  rationale: string;
  rule_trace_json: RuleTrace;
  provenance_json: Provenance;
  dissent_json: Dissent;
  requires_human_review: boolean;
  created_by: string;
}

interface RuleTrace {
  rules_fired: string[]; // e.g., ['R0', 'R2']
  rule_details: Record<string, any>;
  final_scores: Record<string, number>; // claim_id -> score
  winning_claim_id?: string;
  margin: number; // difference between top 2 scores
}

interface Provenance {
  supporting_claim_ids: string[];
  evidence_count: number;
  sop_citations: string[];
}

interface Dissent {
  non_chosen_claims: {
    claim_id: string;
    value: any;
    reason: string;
    score: number;
  }[];
}

/**
 * Arbitration configuration (can be overridden by bank overlays)
 */
export interface ArbitrationConfig {
  agent_weights: Record<string, number>;
  thresholds: {
    auto_choose_margin: number; // minimum margin to auto-choose
    needs_human_margin: number; // if margin < this, flag for human
    blocker_requires_evidence: boolean;
  };
}

/**
 * Default arbitration configuration
 */
export const DEFAULT_ARBITRATION_CONFIG: ArbitrationConfig = {
  agent_weights: {
    sba_policy: 1.0,
    eligibility: 0.95,
    evidence: 0.9,
    cash_flow: 0.85,
    credit: 0.8,
    collateral: 0.7,
    management: 0.65,
    risk: 0.9,
    narrative: 0.4,
    banker_copilot: 0.2,
  },
  thresholds: {
    auto_choose_margin: 0.15, // need 15% lead to auto-choose
    needs_human_margin: 0.05, // if margin < 5%, flag for human
    blocker_requires_evidence: true,
  },
};

/**
 * Group claims into conflict sets by claim_hash
 */
export function groupClaimsIntoConflicts(claims: NormalizedClaim[]): ClaimConflictSet[] {
  const grouped = new Map<string, NormalizedClaim[]>();
  
  for (const claim of claims) {
    const existing = grouped.get(claim.claim_hash) || [];
    existing.push(claim);
    grouped.set(claim.claim_hash, existing);
  }
  
  const conflictSets: ClaimConflictSet[] = [];
  
  for (const [hash, claimGroup] of grouped.entries()) {
    if (claimGroup.length === 0) continue;
    
    const first = claimGroup[0];
    const uniqueAgents = new Set(claimGroup.map(c => c.source_agent));
    const hasBlocker = claimGroup.some(c => c.severity === 'blocker');
    
    conflictSets.push({
      claim_hash: hash,
      topic: first.topic,
      predicate: first.predicate,
      timeframe: first.timeframe,
      unit: first.unit,
      claims: claimGroup,
      num_agents: uniqueAgents.size,
      has_blocker: hasBlocker,
    });
  }
  
  return conflictSets;
}

/**
 * Reconcile a single conflict set using rules R0-R5
 */
export function reconcileConflictSet(
  conflictSet: ClaimConflictSet,
  config: ArbitrationConfig = DEFAULT_ARBITRATION_CONFIG
): ArbitrationDecision {
  const { claims, claim_hash } = conflictSet;
  
  // Single claim = no conflict, choose it
  if (claims.length === 1) {
    return {
      claim_hash,
      chosen_value_json: claims[0].value_json,
      chosen_claim_id: claims[0].finding_id,
      decision_status: 'chosen',
      rationale: 'Only one claim for this topic',
      rule_trace_json: {
        rules_fired: ['SINGLE'],
        rule_details: {},
        final_scores: { [claims[0].finding_id]: 1.0 },
        winning_claim_id: claims[0].finding_id,
        margin: 1.0,
      },
      provenance_json: {
        supporting_claim_ids: [claims[0].finding_id],
        evidence_count: claims[0].evidence_json ? 1 : 0,
        sop_citations: claims[0].sop_citations,
      },
      dissent_json: {
        non_chosen_claims: [],
      },
      requires_human_review: claims[0].severity === 'blocker' && config.thresholds.blocker_requires_evidence,
      created_by: 'system',
    };
  }
  
  // Multiple claims = apply rules
  const ruleTrace: RuleTrace = {
    rules_fired: [],
    rule_details: {},
    final_scores: {},
    margin: 0,
  };
  
  // Initialize scores
  const scores: Record<string, number> = {};
  for (const claim of claims) {
    scores[claim.finding_id] = 0;
  }
  
  // R0: SOP hard rules dominate (blockers from SBA Policy Agent)
  const sbaBlockers = claims.filter(
    c => c.source_agent === 'sba_policy' && c.severity === 'blocker'
  );
  
  if (sbaBlockers.length > 0) {
    ruleTrace.rules_fired.push('R0');
    ruleTrace.rule_details.R0 = 'SBA hard stop detected';
    
    // Give SBA blockers maximum weight
    for (const blocker of sbaBlockers) {
      scores[blocker.finding_id] += 10.0;
    }
  }
  
  // R1: Evidence completeness threshold
  ruleTrace.rules_fired.push('R1');
  for (const claim of claims) {
    const hasEvidence = claim.evidence_json && Object.keys(claim.evidence_json).length > 0;
    const evidenceScore = hasEvidence ? 0.5 : 0.0;
    scores[claim.finding_id] += evidenceScore;
    
    if (!ruleTrace.rule_details.R1) {
      ruleTrace.rule_details.R1 = {};
    }
    ruleTrace.rule_details.R1[claim.finding_id] = { hasEvidence, evidenceScore };
  }
  
  // R2: Confidence-weighted vote (agent weight * confidence)
  ruleTrace.rules_fired.push('R2');
  for (const claim of claims) {
    const agentWeight = config.agent_weights[claim.source_agent] || 0.5;
    const weightedScore = agentWeight * claim.confidence;
    scores[claim.finding_id] += weightedScore;
    
    if (!ruleTrace.rule_details.R2) {
      ruleTrace.rule_details.R2 = {};
    }
    ruleTrace.rule_details.R2[claim.finding_id] = {
      agent: claim.source_agent,
      weight: agentWeight,
      confidence: claim.confidence,
      score: weightedScore,
    };
  }
  
  // R3: Freshness (placeholder - would use doc upload timestamps)
  // TODO: Implement freshness scoring based on document timestamps
  
  // R4: Bank overlay adjustments (applied externally, not here)
  
  // R5: Close-call detection -> needs_human
  const sortedScores = Object.entries(scores).sort(([, a], [, b]) => b - a);
  const topScore = sortedScores[0]?.[1] || 0;
  const secondScore = sortedScores[1]?.[1] || 0;
  const margin = topScore - secondScore;
  
  ruleTrace.final_scores = scores;
  ruleTrace.winning_claim_id = sortedScores[0]?.[0];
  ruleTrace.margin = margin;
  
  // Decision logic
  let decisionStatus: ArbitrationDecision['decision_status'] = 'unresolved';
  let requiresHumanReview = false;
  let rationale = '';
  
  if (margin >= config.thresholds.auto_choose_margin) {
    decisionStatus = 'chosen';
    rationale = `Auto-selected based on weighted score (margin: ${margin.toFixed(2)})`;
  } else if (margin < config.thresholds.needs_human_margin) {
    decisionStatus = 'deferred';
    requiresHumanReview = true;
    rationale = `Close call (margin: ${margin.toFixed(2)}) - requires human review`;
    ruleTrace.rules_fired.push('R5');
  } else {
    decisionStatus = 'chosen';
    requiresHumanReview = true;
    rationale = `Chosen with moderate confidence (margin: ${margin.toFixed(2)}) - review recommended`;
  }
  
  // Check blocker evidence requirement
  if (config.thresholds.blocker_requires_evidence && conflictSet.has_blocker) {
    const winningClaim = claims.find(c => c.finding_id === ruleTrace.winning_claim_id);
    if (winningClaim?.severity === 'blocker') {
      const hasEvidence = winningClaim.evidence_json && Object.keys(winningClaim.evidence_json).length > 0;
      if (!hasEvidence) {
        requiresHumanReview = true;
        rationale += ' (blocker lacks evidence)';
      }
    }
  }
  
  // Build provenance
  const winningClaim = claims.find(c => c.finding_id === ruleTrace.winning_claim_id);
  const provenance: Provenance = {
    supporting_claim_ids: [ruleTrace.winning_claim_id || ''],
    evidence_count: winningClaim?.evidence_json ? Object.keys(winningClaim.evidence_json).length : 0,
    sop_citations: winningClaim?.sop_citations || [],
  };
  
  // Build dissent
  const dissent: Dissent = {
    non_chosen_claims: claims
      .filter(c => c.finding_id !== ruleTrace.winning_claim_id)
      .map(c => ({
        claim_id: c.finding_id,
        value: c.value_json,
        reason: `Score: ${scores[c.finding_id].toFixed(2)} (${c.source_agent})`,
        score: scores[c.finding_id],
      })),
  };
  
  return {
    claim_hash,
    chosen_value_json: winningClaim?.value_json || null,
    chosen_claim_id: ruleTrace.winning_claim_id,
    decision_status: decisionStatus,
    rationale,
    rule_trace_json: ruleTrace,
    provenance_json: provenance,
    dissent_json: dissent,
    requires_human_review: requiresHumanReview,
    created_by: 'system',
  };
}

/**
 * Reconcile all conflict sets
 */
export function reconcileAllConflicts(
  conflictSets: ClaimConflictSet[],
  config: ArbitrationConfig = DEFAULT_ARBITRATION_CONFIG
): ArbitrationDecision[] {
  return conflictSets.map(set => reconcileConflictSet(set, config));
}

/**
 * Materialize truth from arbitration decisions
 */
export function materializeTruth(decisions: ArbitrationDecision[]): Record<string, any> {
  const truth: Record<string, any> = {};
  
  for (const decision of decisions) {
    if (decision.decision_status === 'chosen' && decision.chosen_value_json) {
      // Use claim_hash as key, chosen value as value
      truth[decision.claim_hash] = decision.chosen_value_json;
    }
  }
  
  return truth;
}
