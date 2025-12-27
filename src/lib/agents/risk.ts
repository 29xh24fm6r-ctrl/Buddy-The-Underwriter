/**
 * Risk Synthesis Agent: The Underwriter Brain
 * 
 * Aggregates findings from all other agents and synthesizes an overall risk assessment.
 * This is the "conductor" of the agent orchestra.
 */

import { Agent } from './base';
import type {
  AgentName,
  AgentContext,
  FindingType,
  FindingStatus,
  RiskSynthesisFinding,
  AgentFinding,
} from './types';
import { aiJson } from '@/lib/ai/openai';

interface RiskInput {
  deal_id: string;
  bank_id: string;
  all_findings: AgentFinding[];
}

export class RiskSynthesisAgent extends Agent<RiskInput, RiskSynthesisFinding> {
  name: AgentName = 'risk';
  version = 'v1';
  description = 'Synthesizes all agent findings into overall risk assessment';
  
  validateInput(input: RiskInput): { valid: boolean; error?: string } {
    if (!input.deal_id) {
      return { valid: false, error: 'deal_id is required' };
    }
    if (!input.bank_id) {
      return { valid: false, error: 'bank_id is required' };
    }
    return { valid: true };
  }
  
  async execute(
    input: RiskInput,
    context: AgentContext
  ): Promise<RiskSynthesisFinding> {
    this.log('Synthesizing risk assessment from all agents');
    
    // Group findings by agent
    const findingsByAgent = this.groupFindingsByAgent(input.all_findings);
    
    // Get agent votes
    const agentConsensus = this.calculateAgentConsensus(findingsByAgent);
    
    // Identify top risks
    const top5Risks = this.identifyTopRisks(findingsByAgent);
    
    // Determine overall risk level
    const overallRisk = this.calculateOverallRisk(agentConsensus, top5Risks);
    
    // Calculate overall confidence
    const overallConfidence = this.calculateOverallConfidence(input.all_findings);
    
    // Extract mitigations and conditions
    const mitigations = this.extractMitigations(findingsByAgent);
    const conditions = this.extractConditions(findingsByAgent);
    
    // Make recommendation
    const recommendApprove = this.shouldRecommendApproval(
      overallRisk,
      agentConsensus,
      top5Risks
    );
    
    // Generate executive summary using AI
    const executiveSummary = await this.generateExecutiveSummary(
      overallRisk,
      top5Risks,
      recommendApprove,
      agentConsensus
    );
    
    this.log(`Risk synthesis complete: ${overallRisk} risk, recommend ${recommendApprove ? 'APPROVE' : 'DECLINE'}`);
    
    return {
      overall_risk: overallRisk,
      overall_confidence: overallConfidence,
      top_5_risks: top5Risks,
      mitigations,
      recommend_approve: recommendApprove,
      conditions,
      executive_summary: executiveSummary,
      agent_consensus: agentConsensus,
    };
  }
  
  /**
   * Group findings by agent
   */
  private groupFindingsByAgent(findings: AgentFinding[]): Record<AgentName, AgentFinding[]> {
    const grouped: Record<string, AgentFinding[]> = {};
    
    for (const finding of findings) {
      if (!grouped[finding.agent_name]) {
        grouped[finding.agent_name] = [];
      }
      grouped[finding.agent_name].push(finding);
    }
    
    return grouped as Record<AgentName, AgentFinding[]>;
  }
  
  /**
   * Calculate agent consensus (votes)
   */
  private calculateAgentConsensus(
    findingsByAgent: Record<AgentName, AgentFinding[]>
  ): RiskSynthesisFinding['agent_consensus'] {
    const consensus: RiskSynthesisFinding['agent_consensus'] = [];
    
    for (const [agentName, findings] of Object.entries(findingsByAgent)) {
      if (findings.length === 0) continue;
      
      // Get most recent finding for this agent
      const latest = findings[0];
      
      // Determine vote based on status
      let vote: 'approve' | 'decline' | 'conditional' = 'conditional';
      
      if (latest.status === 'pass') {
        vote = 'approve';
      } else if (latest.status === 'fail') {
        vote = 'decline';
      } else {
        vote = 'conditional';
      }
      
      consensus.push({
        agent_name: agentName as AgentName,
        vote,
        confidence: latest.confidence,
      });
    }
    
    return consensus;
  }
  
  /**
   * Identify top 5 risks from all findings
   */
  private identifyTopRisks(
    findingsByAgent: Record<AgentName, AgentFinding[]>
  ): RiskSynthesisFinding['top_5_risks'] {
    const risks: RiskSynthesisFinding['top_5_risks'] = [];
    
    // Extract risks from each agent
    for (const [agentName, findings] of Object.entries(findingsByAgent)) {
      for (const finding of findings) {
        if (finding.status === 'fail' || finding.status === 'conditional') {
          // Parse risk from output
          const risk = this.parseRiskFromFinding(finding);
          if (risk) {
            risks.push(risk);
          }
        }
      }
    }
    
    // Sort by severity and return top 5
    risks.sort((a, b) => {
      const severityOrder = { high: 3, moderate: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
    
    return risks.slice(0, 5);
  }
  
  /**
   * Parse risk from finding
   */
  private parseRiskFromFinding(
    finding: AgentFinding
  ): RiskSynthesisFinding['top_5_risks'][0] | null {
    const output = finding.output_json;
    
    // Different agents have different output structures
    if (finding.agent_name === 'eligibility') {
      if (!output.overall_eligible) {
        return {
          risk: output.summary || 'Business may not be SBA eligible',
          severity: output.fatal_issues?.length > 0 ? 'high' : 'moderate',
          mitigation: output.checks?.[0]?.mitigation_options?.join('; '),
        };
      }
    }
    
    if (finding.agent_name === 'cash_flow') {
      if (!output.pass) {
        return {
          risk: `Debt service coverage ratio of ${output.global_dscr?.toFixed(2)}x below minimum`,
          severity: output.global_dscr < 1.0 ? 'high' : 'moderate',
          mitigation: 'Increase equity injection, reduce loan amount, or improve cash flow projections',
        };
      }
    }
    
    if (finding.agent_name === 'credit') {
      const derogatories = output.checks?.filter((c: any) => c.derogatories?.length > 0);
      if (derogatories?.length > 0) {
        return {
          risk: 'Credit issues identified',
          severity: output.sba_impact === 'fatal' ? 'high' : 'moderate',
          mitigation: output.mitigation_options?.join('; '),
        };
      }
    }
    
    // Default risk extraction
    if (finding.status === 'fail') {
      return {
        risk: `${finding.agent_name} check failed`,
        severity: 'moderate',
      };
    }
    
    return null;
  }
  
  /**
   * Calculate overall risk level
   */
  private calculateOverallRisk(
    consensus: RiskSynthesisFinding['agent_consensus'],
    topRisks: RiskSynthesisFinding['top_5_risks']
  ): 'low' | 'moderate' | 'high' | 'severe' {
    // Count votes
    const votes = {
      approve: consensus.filter(c => c.vote === 'approve').length,
      decline: consensus.filter(c => c.vote === 'decline').length,
      conditional: consensus.filter(c => c.vote === 'conditional').length,
    };
    
    // Count high severity risks
    const highRisks = topRisks.filter(r => r.severity === 'high').length;
    
    // Decision logic
    if (votes.decline >= 2 || highRisks >= 3) {
      return 'severe';
    }
    
    if (votes.decline >= 1 || highRisks >= 2) {
      return 'high';
    }
    
    if (votes.conditional >= 3 || highRisks >= 1) {
      return 'moderate';
    }
    
    return 'low';
  }
  
  /**
   * Calculate overall confidence
   */
  private calculateOverallConfidence(findings: AgentFinding[]): number {
    if (findings.length === 0) return 0;
    
    const avgConfidence = findings.reduce((sum, f) => sum + f.confidence, 0) / findings.length;
    return Math.min(Math.max(avgConfidence, 0), 1);
  }
  
  /**
   * Extract mitigations from findings
   */
  private extractMitigations(findingsByAgent: Record<AgentName, AgentFinding[]>): string[] {
    const mitigations: string[] = [];
    
    for (const findings of Object.values(findingsByAgent)) {
      for (const finding of findings) {
        const output = finding.output_json;
        
        // Extract mitigation options
        if (output.mitigation_options) {
          mitigations.push(...output.mitigation_options);
        }
        
        if (output.checks) {
          for (const check of output.checks) {
            if (check.mitigation_options) {
              mitigations.push(...check.mitigation_options);
            }
          }
        }
      }
    }
    
    // Deduplicate
    return Array.from(new Set(mitigations));
  }
  
  /**
   * Extract conditions from findings
   */
  private extractConditions(findingsByAgent: Record<AgentName, AgentFinding[]>): string[] {
    const conditions: string[] = [];
    
    // Standard SBA conditions based on findings
    for (const [agentName, findings] of Object.entries(findingsByAgent)) {
      if (findings.some(f => f.status === 'conditional')) {
        switch (agentName) {
          case 'eligibility':
            conditions.push('Verify SBA eligibility documentation');
            break;
          case 'credit':
            conditions.push('Obtain credit explanation letters for all derogatories');
            break;
          case 'cash_flow':
            conditions.push('Provide updated financial projections');
            break;
          case 'collateral':
            conditions.push('Obtain collateral appraisals and UCC searches');
            break;
        }
      }
    }
    
    // Standard conditions for all SBA loans
    conditions.push(
      'SBA Authorization',
      'Satisfactory credit report',
      'Satisfactory environmental review',
      'Proof of hazard insurance',
      'Life insurance on key principals',
      'Personal guarantees from all 20%+ owners'
    );
    
    return Array.from(new Set(conditions));
  }
  
  /**
   * Determine if should recommend approval
   */
  private shouldRecommendApproval(
    overallRisk: RiskSynthesisFinding['overall_risk'],
    consensus: RiskSynthesisFinding['agent_consensus'],
    topRisks: RiskSynthesisFinding['top_5_risks']
  ): boolean {
    // Don't approve severe risk
    if (overallRisk === 'severe') return false;
    
    // Count votes
    const approveVotes = consensus.filter(c => c.vote === 'approve').length;
    const declineVotes = consensus.filter(c => c.vote === 'decline').length;
    
    // More declines than approves = don't recommend
    if (declineVotes >= approveVotes) return false;
    
    // High risk with no mitigations = don't recommend
    const highRisksWithoutMitigation = topRisks.filter(
      r => r.severity === 'high' && !r.mitigation
    ).length;
    
    if (highRisksWithoutMitigation > 0) return false;
    
    // Otherwise, recommend approval with conditions
    return true;
  }
  
  /**
   * Generate executive summary using AI
   */
  private async generateExecutiveSummary(
    overallRisk: string,
    topRisks: RiskSynthesisFinding['top_5_risks'],
    recommendApprove: boolean,
    consensus: RiskSynthesisFinding['agent_consensus']
  ): Promise<string> {
    const prompt = `You are an expert SBA underwriter. Generate a concise executive summary (3-4 sentences) based on:

Risk Level: ${overallRisk}
Recommendation: ${recommendApprove ? 'APPROVE' : 'DECLINE'}

Top Risks:
${topRisks.map(r => `- ${r.risk} (${r.severity})`).join('\n')}

Agent Votes:
${consensus.map(c => `- ${c.agent_name}: ${c.vote} (${(c.confidence * 100).toFixed(0)}%)`).join('\n')}

Write a professional summary explaining the recommendation.`;
    
    try {
      const result = await aiJson<{ summary: string }>({
        scope: 'credit',
        action: 'executive_summary',
        system: 'You are a loan officer writing executive summaries.',
        user: prompt,
        jsonSchemaHint: 'Return { summary: string }',
      });
      
      if (result.ok && result.result) {
        return result.result.summary || 'Unable to generate summary';
      }
      return 'Unable to generate summary';
    } catch (error) {
      this.error('Failed to generate executive summary', error);
      
      // Fallback summary
      return recommendApprove
        ? `This ${overallRisk} risk transaction meets SBA and bank credit standards subject to conditions.`
        : `This ${overallRisk} risk transaction does not meet current credit standards.`;
    }
  }
  
  protected getFindingType(output: RiskSynthesisFinding): FindingType {
    return 'risk';
  }
  
  protected getFindingStatus(output: RiskSynthesisFinding): FindingStatus {
    if (output.recommend_approve) {
      return output.overall_risk === 'low' ? 'pass' : 'conditional';
    }
    return 'fail';
  }
  
  calculateConfidence(output: RiskSynthesisFinding, input: RiskInput): number {
    return output.overall_confidence;
  }
  
  requiresHumanReview(output: RiskSynthesisFinding): boolean {
    // Always require human review for risk synthesis
    return true;
  }
}
