/**
 * Eligibility Agent: The Gatekeeper
 * 
 * Determines if a business is even eligible for SBA financing.
 * Hard stop agent - if ❌ explains why and what fixes exist.
 */

import { Agent } from './base';
import type {
  AgentName,
  AgentContext,
  FindingType,
  FindingStatus,
  EligibilityFinding,
} from './types';
import { supabaseAdmin } from '@/lib/supabase/admin';

interface EligibilityInput {
  deal_id: string;
  bank_id: string;
}

interface EligibilityOutput {
  checks: EligibilityFinding[];
  overall_eligible: boolean;
  fatal_issues: string[];
}

export class EligibilityAgent extends Agent<EligibilityInput, EligibilityOutput> {
  name: AgentName = 'eligibility';
  version = 'v1';
  description = 'SBA eligibility gatekeeper - determines if business qualifies';
  
  validateInput(input: EligibilityInput): { valid: boolean; error?: string } {
    if (!input.deal_id) {
      return { valid: false, error: 'deal_id is required' };
    }
    if (!input.bank_id) {
      return { valid: false, error: 'bank_id is required' };
    }
    return { valid: true };
  }
  
  async execute(
    input: EligibilityInput,
    context: AgentContext
  ): Promise<EligibilityOutput> {
    this.log('Checking SBA eligibility');
    
    // Get deal data
    const deal = await this.getDealData(input.deal_id, input.bank_id);
    
    if (!deal) {
      throw new Error('Deal not found');
    }
    
    const checks: EligibilityFinding[] = [];
    
    // Run all eligibility checks
    checks.push(await this.checkBusinessSize(deal));
    checks.push(await this.checkUseOfProceeds(deal));
    checks.push(await this.checkCitizenship(deal));
    checks.push(await this.checkIneligibleBusiness(deal));
    
    // If franchise, check franchise eligibility
    if (deal.is_franchise) {
      checks.push(await this.checkFranchise(deal));
    }
    
    // Determine fatal issues
    const fatalIssues = checks
      .filter(c => !c.eligible && !c.mitigation_options?.length)
      .map(c => c.reason);
    
    const overallEligible = checks.every(c => c.eligible) && fatalIssues.length === 0;
    
    this.log(`Eligibility check complete. Eligible: ${overallEligible}`);
    
    return {
      checks,
      overall_eligible: overallEligible,
      fatal_issues: fatalIssues,
    };
  }
  
  /**
   * Check business size standards
   */
  private async checkBusinessSize(deal: any): Promise<EligibilityFinding> {
    // SBA size standards vary by NAICS code
    // For simplicity, using employee count (most common)
    const employeeCount = deal.employee_count || 0;
    const annualRevenue = deal.annual_revenue || 0;
    
    // Most industries: <500 employees OR <$7.5M revenue
    // (Real implementation would check specific NAICS standards)
    const isSmallBusiness = employeeCount < 500 || annualRevenue < 7_500_000;
    
    return {
      check_name: 'business_size',
      eligible: isSmallBusiness,
      reason: isSmallBusiness
        ? `Business qualifies as small (${employeeCount} employees, $${(annualRevenue / 1_000_000).toFixed(1)}M revenue)`
        : `Business may exceed SBA size standards (${employeeCount} employees, $${(annualRevenue / 1_000_000).toFixed(1)}M revenue)`,
      mitigation_options: !isSmallBusiness
        ? ['Verify specific NAICS size standard', 'Consider affiliation rules']
        : undefined,
      sop_citation: 'SOP 50 10 3.A - Size Standards',
    };
  }
  
  /**
   * Check use of proceeds eligibility
   */
  private async checkUseOfProceeds(deal: any): Promise<EligibilityFinding> {
    const useOfProceeds = deal.use_of_proceeds || '';
    const lowerUse = useOfProceeds.toLowerCase();
    
    // Ineligible uses per SOP 50 10
    const ineligibleKeywords = [
      'speculation',
      'investment',
      'lending',
      'passive',
      'gambling',
      'pyramid',
      'multi-level marketing',
    ];
    
    const hasIneligibleUse = ineligibleKeywords.some(kw => lowerUse.includes(kw));
    
    return {
      check_name: 'use_of_proceeds',
      eligible: !hasIneligibleUse,
      reason: hasIneligibleUse
        ? 'Use of proceeds may include ineligible activities'
        : 'Use of proceeds appears eligible (working capital, equipment, real estate)',
      mitigation_options: hasIneligibleUse
        ? ['Remove ineligible use from loan request', 'Structure separate conventional loan for ineligible portion']
        : undefined,
      sop_citation: 'SOP 50 10 2.B - Ineligible Businesses',
    };
  }
  
  /**
   * Check citizenship/ownership requirements
   */
  private async checkCitizenship(deal: any): Promise<EligibilityFinding> {
    // Get ownership data
    const sb = supabaseAdmin();
    
    const { data: owners } = await sb
      .from('ownership')
      .select('*')
      .eq('deal_id', deal.id)
      .gte('percentage', 20); // 20%+ owners
    
    // For SBA eligibility, business must be majority US citizen/LPR owned
    // This is simplified - real implementation needs actual citizenship data
    const hasSufficientOwnership = !owners || owners.length > 0;
    
    return {
      check_name: 'citizenship',
      eligible: hasSufficientOwnership,
      reason: hasSufficientOwnership
        ? 'Ownership structure appears compliant (requires verification)'
        : 'Unable to verify majority US citizen/LPR ownership',
      mitigation_options: !hasSufficientOwnership
        ? ['Collect citizenship documentation for all 20%+ owners']
        : undefined,
      sop_citation: 'SOP 50 10 2.A.3 - Ownership Requirements',
    };
  }
  
  /**
   * Check for ineligible business types
   */
  private async checkIneligibleBusiness(deal: any): Promise<EligibilityFinding> {
    const businessType = (deal.business_type || '').toLowerCase();
    const industryNaics = deal.industry_naics || '';
    
    // Ineligible business types per SOP 50 10
    const ineligibleTypes = [
      'passive',
      'speculative',
      'lending',
      'life insurance',
      'project financing',
      'foreign business',
      'pyramid sales',
      'gambling',
      'marijuana',
      'cannabis',
    ];
    
    const isIneligible = ineligibleTypes.some(type => businessType.includes(type));
    
    // Additional NAICS-based checks
    const restrictedNAICS = ['713210', '713290', '812191']; // Gambling-related
    const hasRestrictedNAICS = restrictedNAICS.includes(industryNaics);
    
    const eligible = !isIneligible && !hasRestrictedNAICS;
    
    return {
      check_name: 'ineligible_business',
      eligible,
      reason: eligible
        ? 'Business type is eligible for SBA financing'
        : 'Business type may be ineligible for SBA financing',
      mitigation_options: !eligible
        ? ['Verify business activities', 'Consider conventional financing instead']
        : undefined,
      sop_citation: 'SOP 50 10 2.B - Ineligible Businesses',
    };
  }
  
  /**
   * Check franchise eligibility (if applicable)
   */
  private async checkFranchise(deal: any): Promise<EligibilityFinding> {
    const franchiseName = deal.franchise_name || '';
    
    // In reality, would check SBA Franchise Directory
    // For now, assume eligible unless flagged
    const isInDirectory = franchiseName.length > 0;
    
    return {
      check_name: 'franchise',
      eligible: true, // Placeholder
      reason: isInDirectory
        ? `Franchise "${franchiseName}" - verify SBA Franchise Directory listing`
        : 'Franchise eligibility requires SBA Directory verification',
      mitigation_options: ['Check SBA Franchise Directory', 'Request franchise disclosure documents'],
      sop_citation: 'SOP 50 10 2.C - Franchise Requirements',
    };
  }
  
  /**
   * Get deal data from database
   */
  private async getDealData(deal_id: string, bank_id: string): Promise<any> {
    const sb = supabaseAdmin();
    
    const { data: deal, error } = await sb
      .from('deals')
      .select('*')
      .eq('id', deal_id)
      .eq('bank_id', bank_id)
      .single();
    
    if (error) {
      this.error('Failed to fetch deal', error);
      throw new Error(`Failed to fetch deal: ${error.message}`);
    }
    
    return deal;
  }
  
  protected getFindingType(output: EligibilityOutput): FindingType {
    return 'requirement';
  }
  
  protected getFindingStatus(output: EligibilityOutput): FindingStatus {
    if (!output.overall_eligible) {
      return output.fatal_issues.length > 0 ? 'fail' : 'conditional';
    }
    return 'pass';
  }
  
  calculateConfidence(output: EligibilityOutput, input: EligibilityInput): number {
    // High confidence if all checks passed
    if (output.overall_eligible) return 0.95;
    
    // Medium confidence if there are mitigation options
    const hasMitigations = output.checks.some(c => c.mitigation_options?.length);
    if (hasMitigations) return 0.70;
    
    // High confidence in failure if fatal issues
    if (output.fatal_issues.length > 0) return 0.90;
    
    return 0.60;
  }
  
  requiresHumanReview(output: EligibilityOutput): boolean {
    // Always require review if not eligible
    return !output.overall_eligible;
  }
}
