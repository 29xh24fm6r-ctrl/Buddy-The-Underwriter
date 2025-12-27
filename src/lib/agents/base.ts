/**
 * SBA God Mode: Agent Base Class
 * 
 * Abstract base implementation for all agents.
 * Enforces consistent patterns across the agent swarm.
 */

import { supabaseAdmin } from '@/lib/supabase/admin';
import type {
  AgentName,
  AgentFinding,
  AgentContext,
  BaseAgent,
  FindingType,
  FindingStatus,
} from './types';

export abstract class Agent<TInput = any, TOutput = any> implements BaseAgent<TInput, TOutput> {
  abstract name: AgentName;
  abstract version: string;
  abstract description: string;
  
  /**
   * Execute the agent's core logic
   */
  abstract execute(input: TInput, context: AgentContext): Promise<TOutput>;
  
  /**
   * Validate input before execution
   */
  abstract validateInput(input: TInput): { valid: boolean; error?: string };
  
  /**
   * Calculate confidence score for output
   */
  abstract calculateConfidence(output: TOutput, input: TInput): number;
  
  /**
   * Determine if human review is required
   */
  abstract requiresHumanReview(output: TOutput): boolean;
  
  /**
   * Get finding type for this agent's output
   */
  protected abstract getFindingType(output: TOutput): FindingType;
  
  /**
   * Get finding status for this agent's output
   */
  protected abstract getFindingStatus(output: TOutput): FindingStatus;
  
  /**
   * Main execution wrapper - handles validation, persistence, error handling
   */
  async run(input: TInput, context: AgentContext): Promise<AgentFinding> {
    const startTime = Date.now();
    
    // Validate input
    const validation = this.validateInput(input);
    if (!validation.valid) {
      throw new Error(`${this.name} input validation failed: ${validation.error}`);
    }
    
    try {
      // Execute agent logic
      const output = await this.execute(input, context);
      
      // Calculate confidence
      const confidence = this.calculateConfidence(output, input);
      
      // Create finding record
      const finding: AgentFinding = {
        deal_id: context.deal_id,
        bank_id: context.bank_id,
        agent_name: this.name,
        agent_version: this.version,
        finding_type: this.getFindingType(output),
        status: this.getFindingStatus(output),
        confidence,
        input_json: this.sanitizeInput(input),
        output_json: output as any,
        requires_human_review: this.requiresHumanReview(output),
      };
      
      // Persist to database
      const savedFinding = await this.saveFinding(finding);
      
      const executionTime = Date.now() - startTime;
      console.log(`[${this.name}] Execution completed in ${executionTime}ms (confidence: ${confidence.toFixed(2)})`);
      
      return savedFinding;
      
    } catch (error) {
      console.error(`[${this.name}] Execution failed:`, error);
      
      // Save error finding
      const errorFinding: AgentFinding = {
        deal_id: context.deal_id,
        bank_id: context.bank_id,
        agent_name: this.name,
        agent_version: this.version,
        finding_type: 'requirement',
        status: 'fail',
        confidence: 0,
        input_json: this.sanitizeInput(input),
        output_json: {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
        requires_human_review: true,
      };
      
      await this.saveFinding(errorFinding);
      
      throw error;
    }
  }
  
  /**
   * Save finding to database
   */
  private async saveFinding(finding: AgentFinding): Promise<AgentFinding> {
    const sb = supabaseAdmin();
    
    const { data, error } = await sb
      .from('agent_findings')
      .insert(finding)
      .select()
      .single();
    
    if (error) {
      console.error(`[${this.name}] Failed to save finding:`, error);
      throw new Error(`Failed to save agent finding: ${error.message}`);
    }
    
    return data;
  }
  
  /**
   * Retrieve previous findings for this agent
   */
  protected async getPreviousFindings(
    deal_id: string,
    limit: number = 10
  ): Promise<AgentFinding[]> {
    const sb = supabaseAdmin();
    
    const { data, error } = await sb
      .from('agent_findings')
      .select('*')
      .eq('deal_id', deal_id)
      .eq('agent_name', this.name)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error(`[${this.name}] Failed to retrieve previous findings:`, error);
      return [];
    }
    
    return data || [];
  }
  
  /**
   * Get findings from other agents (for cross-agent collaboration)
   */
  protected async getFindingsFromAgent(
    deal_id: string,
    agent_name: AgentName,
    limit: number = 10
  ): Promise<AgentFinding[]> {
    const sb = supabaseAdmin();
    
    const { data, error } = await sb
      .from('agent_findings')
      .select('*')
      .eq('deal_id', deal_id)
      .eq('agent_name', agent_name)
      .order('created_at', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error(`[${this.name}] Failed to retrieve findings from ${agent_name}:`, error);
      return [];
    }
    
    return data || [];
  }
  
  /**
   * Sanitize input to remove sensitive data before persistence
   */
  protected sanitizeInput(input: TInput): Record<string, any> {
    // Override in subclasses if needed to remove sensitive fields
    return input as any;
  }
  
  /**
   * Check if finding needs refresh (based on age or deal changes)
   */
  protected async needsRefresh(
    deal_id: string,
    max_age_hours: number = 24
  ): Promise<boolean> {
    const previous = await this.getPreviousFindings(deal_id, 1);
    
    if (previous.length === 0) {
      return true;
    }
    
    const latest = previous[0];
    const ageHours = (Date.now() - new Date(latest.created_at!).getTime()) / (1000 * 60 * 60);
    
    return ageHours > max_age_hours;
  }
  
  /**
   * Log agent activity for debugging
   */
  protected log(message: string, data?: any) {
    console.log(`[${this.name}] ${message}`, data || '');
  }
  
  /**
   * Log warning
   */
  protected warn(message: string, data?: any) {
    console.warn(`[${this.name}] ⚠️  ${message}`, data || '');
  }
  
  /**
   * Log error
   */
  protected error(message: string, error?: any) {
    console.error(`[${this.name}] ❌ ${message}`, error || '');
  }
}
