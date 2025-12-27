/**
 * SBA God Mode: Bank Overlay System
 * 
 * Policy-as-code for bank-specific requirements.
 * Overlays can only TIGHTEN (never loosen) SBA SOP compliance.
 */

import type { ArbitrationConfig } from './arbitration';
import type { NormalizedClaim } from './claim-normalization';

/**
 * Bank overlay DSL structure
 */
export interface BankOverlay {
  bank_id: string;
  version: number;
  name: string;
  constraints: BankConstraints;
  risk_triggers: RiskTrigger[];
  doc_requirements: DocRequirement[];
  arbitration_overrides: Partial<ArbitrationConfig>;
  ui_branding?: UIBranding;
}

interface BankConstraints {
  min_global_dscr?: number;
  min_business_dscr?: number;
  min_credit_score?: number;
  max_leverage_multiple?: number;
  [key: string]: any; // extensible
}

interface RiskTrigger {
  id: string;
  if: TriggerCondition;
  then: TriggerAction;
}

interface TriggerCondition {
  topic?: string;
  predicate?: string;
  eq?: any;
  in?: any[];
  gte?: number;
  lte?: number;
  gt?: number;
  lt?: number;
}

interface TriggerAction {
  requires_human_review?: boolean;
  add_conditions?: string[];
  add_documents?: string[];
  severity_override?: 'blocker' | 'warning' | 'info';
}

interface DocRequirement {
  id: string;
  when: TriggerCondition;
  require: string[];
}

interface UIBranding {
  primary_label: string;
  display_name: string;
  logo_url?: string;
}

/**
 * Overlay application result
 */
export interface OverlayApplicationResult {
  triggered_rules: string[];
  added_conditions: string[];
  added_documents: string[];
  requires_human_review_flags: string[];
  adjusted_config: ArbitrationConfig | null;
  generated_claims: NormalizedClaim[];
}

/**
 * Evaluate a trigger condition against current deal state
 */
export function evaluateTriggerCondition(
  condition: TriggerCondition,
  claims: NormalizedClaim[],
  dealData?: any
): boolean {
  // Find claims matching the topic/predicate
  const matchingClaims = claims.filter(c => {
    if (condition.topic && c.topic !== condition.topic) return false;
    if (condition.predicate && c.predicate !== condition.predicate) return false;
    return true;
  });
  
  if (matchingClaims.length === 0) return false;
  
  // Evaluate condition operators
  for (const claim of matchingClaims) {
    const value = extractValue(claim.value_json);
    
    if (condition.eq !== undefined && value === condition.eq) return true;
    if (condition.in && condition.in.includes(value)) return true;
    if (condition.gte !== undefined && typeof value === 'number' && value >= condition.gte) return true;
    if (condition.lte !== undefined && typeof value === 'number' && value <= condition.lte) return true;
    if (condition.gt !== undefined && typeof value === 'number' && value > condition.gt) return true;
    if (condition.lt !== undefined && typeof value === 'number' && value < condition.lt) return true;
  }
  
  return false;
}

/**
 * Extract primary value from claim value_json
 */
function extractValue(valueJson: any): any {
  // Try common patterns
  if (typeof valueJson === 'string' || typeof valueJson === 'number' || typeof valueJson === 'boolean') {
    return valueJson;
  }
  
  if (valueJson.value !== undefined) return valueJson.value;
  if (valueJson.dscr !== undefined) return valueJson.dscr;
  if (valueJson.eligible !== undefined) return valueJson.eligible;
  if (valueJson.status !== undefined) return valueJson.status;
  
  return null;
}

/**
 * Apply bank overlay to deal claims
 */
export function applyBankOverlay(
  overlay: BankOverlay,
  claims: NormalizedClaim[],
  dealData?: any,
  baseConfig: ArbitrationConfig = {} as ArbitrationConfig
): OverlayApplicationResult {
  const result: OverlayApplicationResult = {
    triggered_rules: [],
    added_conditions: [],
    added_documents: [],
    requires_human_review_flags: [],
    adjusted_config: null,
    generated_claims: [],
  };
  
  // Apply constraint-based claims (e.g., min DSCR requirements)
  result.generated_claims.push(...generateConstraintClaims(overlay, claims));
  
  // Evaluate risk triggers
  for (const trigger of overlay.risk_triggers) {
    const triggered = evaluateTriggerCondition(trigger.if, claims, dealData);
    
    if (triggered) {
      result.triggered_rules.push(trigger.id);
      
      if (trigger.then.requires_human_review) {
        result.requires_human_review_flags.push(trigger.id);
      }
      
      if (trigger.then.add_conditions) {
        result.added_conditions.push(...trigger.then.add_conditions);
      }
      
      if (trigger.then.add_documents) {
        result.added_documents.push(...trigger.then.add_documents);
      }
    }
  }
  
  // Evaluate doc requirements
  for (const docReq of overlay.doc_requirements) {
    const triggered = evaluateTriggerCondition(docReq.when, claims, dealData);
    
    if (triggered) {
      result.triggered_rules.push(docReq.id);
      result.added_documents.push(...docReq.require);
    }
  }
  
  // Apply arbitration config overrides
  if (overlay.arbitration_overrides && Object.keys(overlay.arbitration_overrides).length > 0) {
    result.adjusted_config = mergeArbitrationConfigs(baseConfig, overlay.arbitration_overrides);
  }
  
  return result;
}

/**
 * Generate constraint claims from overlay (e.g., bank requires higher DSCR)
 */
function generateConstraintClaims(
  overlay: BankOverlay,
  existingClaims: NormalizedClaim[]
): NormalizedClaim[] {
  const generatedClaims: NormalizedClaim[] = [];
  
  // Example: min_global_dscr constraint
  if (overlay.constraints.min_global_dscr) {
    const dscrClaims = existingClaims.filter(c => c.topic === 'dscr' && c.predicate === 'global_dscr');
    
    if (dscrClaims.length > 0) {
      const firstClaim = dscrClaims[0];
      const actualDSCR = extractValue(firstClaim.value_json) as number;
      const requiredDSCR = overlay.constraints.min_global_dscr;
      
      // Only generate claim if overlay is STRICTER than SBA
      if (requiredDSCR > 1.25) { // 1.25 is SBA minimum
        generatedClaims.push({
          deal_id: firstClaim.deal_id,
          bank_id: firstClaim.bank_id,
          claim_hash: firstClaim.claim_hash + '_bank_overlay',
          topic: 'dscr',
          predicate: 'bank_min_dscr',
          value_json: {
            required: requiredDSCR,
            actual: actualDSCR,
            pass: actualDSCR >= requiredDSCR,
          },
          unit: 'ratio',
          source_agent: 'bank_overlay' as any,
          finding_id: 'overlay_generated',
          sop_citations: [],
          confidence: 1.0,
          severity: actualDSCR >= requiredDSCR ? 'info' : 'warning',
        });
      }
    }
  }
  
  // Example: min_credit_score constraint
  if (overlay.constraints.min_credit_score) {
    const creditClaims = existingClaims.filter(c => c.topic === 'credit');
    
    if (creditClaims.length > 0) {
      const requiredScore = overlay.constraints.min_credit_score;
      
      // Generate claim (actual score would come from Credit Agent in Phase 2)
      generatedClaims.push({
        deal_id: creditClaims[0].deal_id,
        bank_id: creditClaims[0].bank_id,
        claim_hash: 'credit_score_bank_min',
        topic: 'credit',
        predicate: 'bank_min_credit_score',
        value_json: {
          required: requiredScore,
          source: 'bank_overlay',
        },
        source_agent: 'bank_overlay' as any,
        finding_id: 'overlay_generated',
        sop_citations: [],
        confidence: 1.0,
        severity: 'info',
      });
    }
  }
  
  return generatedClaims;
}

/**
 * Merge arbitration configs (overlay can adjust weights/thresholds)
 */
function mergeArbitrationConfigs(
  base: ArbitrationConfig,
  overlay: Partial<ArbitrationConfig>
): ArbitrationConfig {
  return {
    agent_weights: {
      ...base.agent_weights,
      ...(overlay.agent_weights || {}),
    },
    thresholds: {
      ...base.thresholds,
      ...(overlay.thresholds || {}),
    },
  };
}

/**
 * Validate overlay (ensures it only tightens, never loosens SBA requirements)
 */
export function validateBankOverlay(overlay: BankOverlay): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Check DSCR constraint
  if (overlay.constraints.min_global_dscr !== undefined) {
    if (overlay.constraints.min_global_dscr < 1.25) {
      errors.push('min_global_dscr cannot be lower than SBA minimum of 1.25');
    }
  }
  
  // Check that triggers don't remove SBA requirements
  // (This would require knowledge of SBA baseline - simplified here)
  
  // Ensure arbitration overrides don't lower agent weights for critical agents
  if (overlay.arbitration_overrides?.agent_weights) {
    if (overlay.arbitration_overrides.agent_weights.sba_policy !== undefined &&
        overlay.arbitration_overrides.agent_weights.sba_policy < 1.0) {
      errors.push('Cannot lower weight of sba_policy agent below 1.0');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Default overlay template
 */
export const DEFAULT_BANK_OVERLAY: BankOverlay = {
  bank_id: 'default',
  version: 1,
  name: 'Default Bank Overlay',
  constraints: {
    min_global_dscr: 1.25, // SBA minimum
    min_credit_score: 680,
  },
  risk_triggers: [],
  doc_requirements: [],
  arbitration_overrides: {},
  ui_branding: {
    primary_label: 'Underwriting Policy',
    display_name: 'Default Bank',
  },
};
