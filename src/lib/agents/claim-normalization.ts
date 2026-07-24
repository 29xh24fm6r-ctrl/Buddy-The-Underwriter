/**
 * SBA God Mode: Claim Normalization
 * 
 * Converts agent findings into normalized claims for arbitration.
 * Each agent output gets mapped to 1..N atomic claims.
 */

import type { AgentFinding, AgentName } from './types';

/**
 * Normalized claim structure
 */
export interface NormalizedClaim {
  deal_id: string;
  bank_id: string;
  claim_hash: string;
  topic: ClaimTopic;
  predicate: string;
  value_json: Record<string, any>;
  unit?: string;
  timeframe?: string;
  source_agent: AgentName;
  finding_id: string;
  evidence_json?: Record<string, any>;
  sop_citations: string[];
  confidence: number;
  severity: ClaimSeverity;
}

export type ClaimTopic =
  | 'eligibility'
  | 'use_of_proceeds'
  | 'equity_injection'
  | 'cash_flow'
  | 'dscr'
  | 'credit'
  | 'collateral'
  | 'management'
  | 'industry'
  | 'franchise'
  | 'ownership'
  | 'citizenship'
  | 'tax_compliance'
  | 'insurance'
  | 'other';

export type ClaimSeverity = 'info' | 'warning' | 'blocker';

/**
 * Generate stable hash for claim (for conflict detection)
 */
export function generateClaimHash(
  topic: string,
  predicate: string,
  timeframe?: string,
  unit?: string
): string {
  const parts = [topic, predicate, timeframe || '', unit || ''];
  const hashInput = parts.join('|');
  
  // Simple hash (in production, use crypto.subtle or similar)
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(36);
}

/**
 * Normalize finding from SBA Policy Agent
 */
function normalizeSBAPolicyFinding(finding: AgentFinding): NormalizedClaim[] {
  const claims: NormalizedClaim[] = [];
  const output = finding.output_json as any;
  
  if (!Array.isArray(output)) {
    return claims;
  }
  
  for (const policyFinding of output) {
    // Map rule_id to topic
    let topic: ClaimTopic = 'other';
    if (policyFinding.rule_id?.includes('EQUITY')) {
      topic = 'equity_injection';
    } else if (policyFinding.rule_id?.includes('USE_OF_PROCEEDS')) {
      topic = 'use_of_proceeds';
    } else if (policyFinding.rule_id?.includes('ELIGIBILITY')) {
      topic = 'eligibility';
    }
    
    const predicate = policyFinding.requirement || policyFinding.rule_id;
    const claimHash = generateClaimHash(topic, predicate);
    
    claims.push({
      deal_id: finding.deal_id,
      bank_id: finding.bank_id,
      claim_hash: claimHash,
      topic,
      predicate,
      value_json: {
        status: policyFinding.status,
        explanation: policyFinding.explanation,
      },
      source_agent: finding.agent_name,
      finding_id: finding.id!,
      sop_citations: [policyFinding.citation || ''],
      confidence: policyFinding.confidence || finding.confidence,
      severity: policyFinding.status === 'fail' ? 'blocker' : 'info',
    });
  }
  
  return claims;
}

/**
 * Normalize finding from Eligibility Agent
 */
function normalizeEligibilityFinding(finding: AgentFinding): NormalizedClaim[] {
  const claims: NormalizedClaim[] = [];
  const output = finding.output_json as any;
  
  // Overall eligibility claim
  const overallHash = generateClaimHash('eligibility', 'overall_eligible');
  claims.push({
    deal_id: finding.deal_id,
    bank_id: finding.bank_id,
    claim_hash: overallHash,
    topic: 'eligibility',
    predicate: 'overall_eligible',
    value_json: {
      eligible: output.overall_eligible,
      fatal_issues: output.fatal_issues || [],
    },
    source_agent: finding.agent_name,
    finding_id: finding.id!,
    sop_citations: [],
    confidence: finding.confidence,
    severity: output.overall_eligible ? 'info' : 'blocker',
  });
  
  // Individual check claims
  if (output.checks && Array.isArray(output.checks)) {
    for (const check of output.checks) {
      const predicate = check.check_name;
      const claimHash = generateClaimHash('eligibility', predicate);
      
      claims.push({
        deal_id: finding.deal_id,
        bank_id: finding.bank_id,
        claim_hash: claimHash,
        topic: 'eligibility',
        predicate,
        value_json: {
          eligible: check.eligible,
          reason: check.reason,
          mitigation_options: check.mitigation_options,
        },
        source_agent: finding.agent_name,
        finding_id: finding.id!,
        sop_citations: [check.sop_citation || ''],
        confidence: finding.confidence,
        severity: check.eligible ? 'info' : 'warning',
      });
    }
  }
  
  return claims;
}

/**
 * Normalize finding from Cash Flow Agent
 */
function normalizeCashFlowFinding(finding: AgentFinding): NormalizedClaim[] {
  const claims: NormalizedClaim[] = [];
  const output = finding.output_json as any;
  
  // Global DSCR claim
  if (output.global_dscr !== undefined) {
    const claimHash = generateClaimHash('dscr', 'global_dscr');
    claims.push({
      deal_id: finding.deal_id,
      bank_id: finding.bank_id,
      claim_hash: claimHash,
      topic: 'dscr',
      predicate: 'global_dscr',
      value_json: {
        dscr: output.global_dscr,
        pass: output.pass,
        summary: output.summary,
      },
      unit: 'ratio',
      source_agent: finding.agent_name,
      finding_id: finding.id!,
      sop_citations: ['SOP 50 10 - DSCR requirement'],
      confidence: finding.confidence,
      severity: output.pass ? 'info' : output.global_dscr >= 1.0 ? 'warning' : 'blocker',
    });
  }
  
  // Year-specific DSCR claims
  if (output.years && Array.isArray(output.years)) {
    for (const year of output.years) {
      const claimHash = generateClaimHash('dscr', 'year_dscr', year.year?.toString());
      claims.push({
        deal_id: finding.deal_id,
        bank_id: finding.bank_id,
        claim_hash: claimHash,
        topic: 'dscr',
        predicate: 'year_dscr',
        value_json: {
          dscr: year.dscr,
          net_income: year.net_income,
          adjusted_cash_flow: year.adjusted_cash_flow,
          adjustments: year.adjustments,
        },
        unit: 'ratio',
        timeframe: year.year?.toString(),
        source_agent: finding.agent_name,
        finding_id: finding.id!,
        sop_citations: [],
        confidence: finding.confidence,
        severity: year.pass ? 'info' : 'warning',
      });
    }
  }
  
  return claims;
}

/**
 * Normalize finding from Credit Agent
 */
function normalizeCreditFinding(finding: AgentFinding): NormalizedClaim[] {
  const claims: NormalizedClaim[] = [];
  const output = finding.output_json as any;

  const overallHash = generateClaimHash('credit', 'sba_impact');
  claims.push({
    deal_id: finding.deal_id,
    bank_id: finding.bank_id,
    claim_hash: overallHash,
    topic: 'credit',
    predicate: 'sba_impact',
    value_json: {
      sba_impact: output.sba_impact,
      overall_pass: output.overall_pass,
      summary: output.summary,
    },
    source_agent: finding.agent_name,
    finding_id: finding.id!,
    sop_citations: [],
    confidence: finding.confidence,
    severity: output.sba_impact === 'fatal' ? 'blocker' : output.sba_impact === 'mitigable' ? 'warning' : 'info',
  });

  if (Array.isArray(output.checks)) {
    for (const check of output.checks as any[]) {
      const timeframe = check.borrower_id ? String(check.borrower_id) : undefined;
      const claimHash = generateClaimHash('credit', check.check_name, timeframe);
      claims.push({
        deal_id: finding.deal_id,
        bank_id: finding.bank_id,
        claim_hash: claimHash,
        topic: 'credit',
        predicate: check.check_name,
        value_json: {
          passed: check.passed,
          detail: check.detail,
          derogatories: check.derogatories,
          borrower_name: check.borrower_name,
        },
        timeframe,
        source_agent: finding.agent_name,
        finding_id: finding.id!,
        sop_citations: [check.sop_citation || ''],
        confidence: finding.confidence,
        severity: check.passed
          ? 'info'
          : check.check_name === 'caivrs' || check.check_name === 'sam_exclusion'
            ? 'blocker'
            : 'warning',
      });
    }
  }

  return claims;
}

/**
 * Normalize finding from Collateral Agent
 */
function normalizeCollateralFinding(finding: AgentFinding): NormalizedClaim[] {
  const claims: NormalizedClaim[] = [];
  const output = finding.output_json as any;

  const claimHash = generateClaimHash('collateral', 'sop_compliant');
  claims.push({
    deal_id: finding.deal_id,
    bank_id: finding.bank_id,
    claim_hash: claimHash,
    topic: 'collateral',
    predicate: 'sop_compliant',
    value_json: {
      sop_compliant: output.sop_compliant,
      total_collateral_value: output.total_collateral_value,
      loan_amount: output.loan_amount,
      shortfall: output.shortfall,
      shortfall_amount: output.shortfall_amount,
      explanation: output.explanation,
    },
    source_agent: finding.agent_name,
    finding_id: finding.id!,
    sop_citations: [],
    confidence: finding.confidence,
    severity: output.sop_compliant === false ? 'warning' : 'info',
  });

  return claims;
}

/**
 * Normalize finding from Management Agent
 */
function normalizeManagementFinding(finding: AgentFinding): NormalizedClaim[] {
  const claims: NormalizedClaim[] = [];
  const output = finding.output_json as any;

  if (Array.isArray(output.principals)) {
    for (const principal of output.principals as any[]) {
      const claimHash = generateClaimHash('management', 'principal_experience', principal.principal_name);
      claims.push({
        deal_id: finding.deal_id,
        bank_id: finding.bank_id,
        claim_hash: claimHash,
        topic: 'management',
        predicate: 'principal_experience',
        value_json: {
          principal_name: principal.principal_name,
          years_experience: principal.years_experience,
          industry_match: principal.industry_match,
          relevance_score: principal.relevance_score,
          concerns: principal.concerns,
        },
        timeframe: principal.principal_name,
        source_agent: finding.agent_name,
        finding_id: finding.id!,
        sop_citations: [],
        confidence: finding.confidence,
        severity: principal.concerns?.length > 0 ? 'warning' : 'info',
      });
    }
  }

  return claims;
}

/**
 * Normalize finding from Risk Synthesis Agent
 */
function normalizeRiskFinding(finding: AgentFinding): NormalizedClaim[] {
  const claims: NormalizedClaim[] = [];
  const output = finding.output_json as any;
  
  // Overall risk claim
  const claimHash = generateClaimHash('other', 'overall_risk');
  claims.push({
    deal_id: finding.deal_id,
    bank_id: finding.bank_id,
    claim_hash: claimHash,
    topic: 'other',
    predicate: 'overall_risk',
    value_json: {
      risk_level: output.overall_risk,
      recommend_approve: output.recommend_approve,
      executive_summary: output.executive_summary,
      top_risks: output.top_5_risks,
      conditions: output.conditions,
    },
    source_agent: finding.agent_name,
    finding_id: finding.id!,
    sop_citations: [],
    confidence: output.overall_confidence || finding.confidence,
    severity: output.recommend_approve ? 'info' : 'blocker',
  });
  
  return claims;
}

/**
 * Main normalization function - routes to agent-specific normalizers
 */
export function normalizeAgentFinding(finding: AgentFinding): NormalizedClaim[] {
  switch (finding.agent_name) {
    case 'sba_policy':
      return normalizeSBAPolicyFinding(finding);
    
    case 'eligibility':
      return normalizeEligibilityFinding(finding);
    
    case 'cash_flow':
      return normalizeCashFlowFinding(finding);
    
    case 'risk':
      return normalizeRiskFinding(finding);

    case 'credit':
      return normalizeCreditFinding(finding);

    case 'collateral':
      return normalizeCollateralFinding(finding);

    case 'management':
      return normalizeManagementFinding(finding);

    case 'narrative':
    case 'evidence':
    case 'banker_copilot':
      // TODO: Implement normalizers for these agents
      return [];
    
    default:
      console.warn(`No normalizer for agent: ${finding.agent_name}`);
      return [];
  }
}

/**
 * Batch normalize multiple findings
 */
export function normalizeAgentFindings(findings: AgentFinding[]): NormalizedClaim[] {
  return findings.flatMap(finding => normalizeAgentFinding(finding));
}
