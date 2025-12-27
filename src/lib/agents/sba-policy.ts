/**
 * SBA Policy Agent: The Law
 * 
 * Canonical source of truth for SBA SOP 50 10 requirements.
 * Never guesses. Never hallucinates. Always cites.
 * 
 * This agent provides deterministic SBA policy checks with citations.
 */

import { Agent } from './base';
import type {
  AgentName,
  AgentContext,
  FindingType,
  FindingStatus,
  SBAPolicyFinding,
} from './types';
import { aiJson } from '@/lib/ai/openai';

interface SBAPolicyInput {
  deal_id: string;
  bank_id: string;
  loan_program: '7a' | 'express' | '504';
  loan_amount?: number;
  industry_naics?: string;
  use_of_proceeds?: string[];
  business_age_years?: number;
  equity_injection_pct?: number;
  check_rules?: string[]; // Specific rules to check
}

export class SBAPolicyAgent extends Agent<SBAPolicyInput, SBAPolicyFinding[]> {
  name: AgentName = 'sba_policy';
  version = 'v1';
  description = 'SBA SOP 50 10 policy compliance checker - canonical truth source';
  
  validateInput(input: SBAPolicyInput): { valid: boolean; error?: string } {
    if (!input.deal_id) {
      return { valid: false, error: 'deal_id is required' };
    }
    if (!input.bank_id) {
      return { valid: false, error: 'bank_id is required' };
    }
    if (!input.loan_program) {
      return { valid: false, error: 'loan_program is required' };
    }
    return { valid: true };
  }
  
  async execute(
    input: SBAPolicyInput,
    context: AgentContext
  ): Promise<SBAPolicyFinding[]> {
    this.log('Executing SBA policy checks', { loan_program: input.loan_program });
    
    const findings: SBAPolicyFinding[] = [];
    
    // Layer 1: Program-level rules
    findings.push(...await this.checkProgramRules(input));
    
    // Layer 2: Eligibility rules
    findings.push(...await this.checkEligibilityRules(input));
    
    // Layer 3: Credit standards
    findings.push(...await this.checkCreditStandards(input));
    
    // Layer 4: Use of proceeds
    if (input.use_of_proceeds) {
      findings.push(...await this.checkUseOfProceeds(input));
    }
    
    // Layer 5: Equity injection
    if (input.equity_injection_pct !== undefined) {
      findings.push(...await this.checkEquityInjection(input));
    }
    
    this.log(`Completed ${findings.length} policy checks`);
    
    return findings;
  }
  
  /**
   * Check program-specific rules
   */
  private async checkProgramRules(input: SBAPolicyInput): Promise<SBAPolicyFinding[]> {
    const findings: SBAPolicyFinding[] = [];
    
    // SBA 7(a) loan amount limits
    if (input.loan_program === '7a' && input.loan_amount) {
      const maxAmount = 5_000_000; // $5M max for standard 7(a)
      
      findings.push({
        rule_id: 'SOP_50_10_4_A',
        requirement: '7(a) Maximum Loan Amount',
        status: input.loan_amount <= maxAmount ? 'pass' : 'fail',
        citation: 'SOP 50 10 4.A - Maximum loan amount for 7(a) is $5,000,000',
        explanation: input.loan_amount <= maxAmount
          ? `Loan amount $${input.loan_amount.toLocaleString()} is within the 7(a) maximum of $${maxAmount.toLocaleString()}`
          : `Loan amount $${input.loan_amount.toLocaleString()} exceeds the 7(a) maximum of $${maxAmount.toLocaleString()}`,
        confidence: 1.0, // Deterministic rule
      });
    }
    
    // SBA Express limits
    if (input.loan_program === 'express' && input.loan_amount) {
      const maxAmount = 500_000; // $500K max for Express
      
      findings.push({
        rule_id: 'SOP_50_10_4_A_EXPRESS',
        requirement: 'SBA Express Maximum Loan Amount',
        status: input.loan_amount <= maxAmount ? 'pass' : 'fail',
        citation: 'SOP 50 10 4.A - Maximum loan amount for SBA Express is $500,000',
        explanation: input.loan_amount <= maxAmount
          ? `Loan amount $${input.loan_amount.toLocaleString()} is within the Express maximum`
          : `Loan amount $${input.loan_amount.toLocaleString()} exceeds Express maximum. Consider standard 7(a).`,
        confidence: 1.0,
      });
    }
    
    return findings;
  }
  
  /**
   * Check eligibility rules
   */
  private async checkEligibilityRules(input: SBAPolicyInput): Promise<SBAPolicyFinding[]> {
    const findings: SBAPolicyFinding[] = [];
    
    // Business age requirement (typically 2 years for conventional)
    if (input.business_age_years !== undefined) {
      findings.push({
        rule_id: 'SOP_50_10_6_B_1',
        requirement: 'Business Operating History',
        status: input.business_age_years >= 0 ? 'pass' : 'fail',
        citation: 'SOP 50 10 6.B.1 - SBA allows startups and existing businesses',
        explanation: input.business_age_years >= 2
          ? 'Business has sufficient operating history'
          : input.business_age_years > 0
          ? 'Business is relatively new but SBA allows new businesses with strong management'
          : 'Startup business - requires detailed business plan and strong management experience',
        confidence: 1.0,
      });
    }
    
    return findings;
  }
  
  /**
   * Check credit standards
   */
  private async checkCreditStandards(input: SBAPolicyInput): Promise<SBAPolicyFinding[]> {
    const findings: SBAPolicyFinding[] = [];
    
    // Placeholder - actual credit checks done by Credit Agent
    findings.push({
      rule_id: 'SOP_50_10_6_C',
      requirement: 'Credit History Review',
      status: 'pending',
      citation: 'SOP 50 10 6.C - Lender must review credit history of principals',
      explanation: 'Credit history will be reviewed by Credit Agent',
      confidence: 1.0,
    });
    
    return findings;
  }
  
  /**
   * Check use of proceeds compliance
   */
  private async checkUseOfProceeds(input: SBAPolicyInput): Promise<SBAPolicyFinding[]> {
    const findings: SBAPolicyFinding[] = [];
    
    const ineligibleUses = [
      'speculation',
      'investment',
      'lending',
      'pyramid sales',
      'gambling',
      'charitable',
      'religious',
    ];
    
    for (const use of input.use_of_proceeds || []) {
      const lowerUse = use.toLowerCase();
      const isIneligible = ineligibleUses.some(inelig => lowerUse.includes(inelig));
      
      if (isIneligible) {
        findings.push({
          rule_id: 'SOP_50_10_2_B',
          requirement: 'Eligible Use of Proceeds',
          status: 'fail',
          citation: 'SOP 50 10 2.B - Ineligible uses of proceeds',
          explanation: `Use "${use}" may be ineligible under SBA guidelines`,
          confidence: 0.85, // Some judgment required
        });
      }
    }
    
    // If all uses passed
    if (findings.length === 0) {
      findings.push({
        rule_id: 'SOP_50_10_2_A',
        requirement: 'Eligible Use of Proceeds',
        status: 'pass',
        citation: 'SOP 50 10 2.A - Eligible uses include working capital, equipment, real estate',
        explanation: 'All stated uses of proceeds appear eligible',
        confidence: 0.95,
      });
    }
    
    return findings;
  }
  
  /**
   * Check equity injection requirements
   */
  private async checkEquityInjection(input: SBAPolicyInput): Promise<SBAPolicyFinding[]> {
    const findings: SBAPolicyFinding[] = [];
    
    // Standard equity injection requirement
    const requiredEquity = input.business_age_years && input.business_age_years < 2 ? 0.10 : 0.0;
    const actualEquity = input.equity_injection_pct || 0;
    
    findings.push({
      rule_id: 'SOP_50_10_6_B_2',
      requirement: 'Equity Injection',
      status: actualEquity >= requiredEquity ? 'pass' : 'conditional',
      citation: 'SOP 50 10 6.B.2 - Equity injection requirements',
      explanation: requiredEquity > 0
        ? `New businesses typically require 10% equity injection. Current: ${(actualEquity * 100).toFixed(1)}%`
        : `Established businesses may not require equity injection. Current: ${(actualEquity * 100).toFixed(1)}%`,
      confidence: 0.90,
    });
    
    return findings;
  }
  
  protected getFindingType(output: SBAPolicyFinding[]): FindingType {
    return 'requirement';
  }
  
  protected getFindingStatus(output: SBAPolicyFinding[]): FindingStatus {
    // Overall status = worst individual status
    const hasFailures = output.some(f => f.status === 'fail');
    const hasConditional = output.some(f => f.status === 'conditional');
    
    if (hasFailures) return 'fail';
    if (hasConditional) return 'conditional';
    return 'pass';
  }
  
  calculateConfidence(output: SBAPolicyFinding[], input: SBAPolicyInput): number {
    if (output.length === 0) return 0;
    
    // Average confidence across all findings
    const avgConfidence = output.reduce((sum, f) => sum + f.confidence, 0) / output.length;
    return Math.min(Math.max(avgConfidence, 0), 1);
  }
  
  requiresHumanReview(output: SBAPolicyFinding[]): boolean {
    // Require human review if any finding failed or has low confidence
    return output.some(f => 
      f.status === 'fail' || 
      f.status === 'conditional' || 
      f.confidence < 0.90
    );
  }
}
