/**
 * SBA God Mode: Agent Orchestrator
 * 
 * Coordinates the agent swarm, manages execution order,
 * handles dependencies, and aggregates results.
 */

import type {
  AgentName,
  AgentContext,
  AgentOrchestrationResult,
  AgentFinding,
} from './types';
import { Agent } from './base';

/**
 * Agent execution graph
 * Defines dependencies and execution order
 */
const AGENT_DEPENDENCIES: Record<AgentName, AgentName[]> = {
  // Layer 1: Independent agents (no dependencies)
  sba_policy: [],
  eligibility: [],
  credit: [],
  
  // Layer 2: Depends on Layer 1
  cash_flow: ['credit'], // Needs credit for add-back validation
  collateral: ['eligibility'], // Needs eligibility for collateral requirements
  management: [], // Independent
  
  // Layer 3: Synthesis agents (depend on most others)
  risk: ['eligibility', 'credit', 'cash_flow', 'collateral', 'management'],
  narrative: ['eligibility', 'credit', 'cash_flow', 'collateral', 'management', 'risk'],
  evidence: ['narrative'], // Validates narrative claims
  
  // Layer 4: Banker tools
  banker_copilot: [], // Can run anytime, uses all available findings
};

/**
 * Agent registry
 */
class AgentRegistry {
  private agents: Map<AgentName, Agent<any, any>> = new Map();
  
  register(agent: Agent<any, any>) {
    this.agents.set(agent.name, agent);
  }
  
  get(name: AgentName): Agent<any, any> | undefined {
    return this.agents.get(name);
  }
  
  has(name: AgentName): boolean {
    return this.agents.has(name);
  }
  
  getAll(): Agent<any, any>[] {
    return Array.from(this.agents.values());
  }
}

export const agentRegistry = new AgentRegistry();

/**
 * Orchestrator for agent swarm
 */
export class AgentOrchestrator {
  private registry: AgentRegistry;
  
  constructor(registry: AgentRegistry = agentRegistry) {
    this.registry = registry;
  }
  
  /**
   * Execute a single agent
   */
  async executeAgent(
    agentName: AgentName,
    input: any,
    context: AgentContext
  ): Promise<AgentFinding> {
    const agent = this.registry.get(agentName);
    
    if (!agent) {
      throw new Error(`Agent not found: ${agentName}`);
    }
    
    return agent.run(input, context);
  }
  
  /**
   * Execute multiple agents in dependency order
   */
  async executeAgents(
    agentNames: AgentName[],
    context: AgentContext,
    inputFactory?: (agentName: AgentName, previousFindings: AgentFinding[]) => Promise<any>
  ): Promise<AgentOrchestrationResult> {
    const startTime = Date.now();
    const session_id = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    const findings: AgentFinding[] = [];
    const errors: { agent_name: AgentName; error: string }[] = [];
    
    // Topological sort to respect dependencies
    const executionOrder = this.getExecutionOrder(agentNames);
    
    console.log(`[Orchestrator] Executing ${executionOrder.length} agents in order:`, executionOrder);
    
    for (const agentName of executionOrder) {
      try {
        const agent = this.registry.get(agentName);
        
        if (!agent) {
          throw new Error(`Agent not registered: ${agentName}`);
        }
        
        // Generate input for this agent
        const input = inputFactory
          ? await inputFactory(agentName, findings)
          : await this.getDefaultInput(agentName, context, findings);
        
        // Execute agent
        const finding = await agent.run(input, { ...context, session_id });
        findings.push(finding);
        
        console.log(`[Orchestrator] ✓ ${agentName} completed (confidence: ${finding.confidence.toFixed(2)})`);
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ agent_name: agentName, error: errorMessage });
        console.error(`[Orchestrator] ✗ ${agentName} failed:`, errorMessage);
      }
    }
    
    const executionTime = Date.now() - startTime;
    
    // Calculate overall confidence (weighted average)
    const overallConfidence = findings.length > 0
      ? findings.reduce((sum, f) => sum + f.confidence, 0) / findings.length
      : 0;
    
    return {
      deal_id: context.deal_id,
      bank_id: context.bank_id,
      session_id,
      agents_executed: executionOrder,
      findings,
      errors,
      execution_time_ms: executionTime,
      overall_confidence: overallConfidence,
    };
  }
  
  /**
   * Execute full SBA underwriting pipeline
   */
  async executeSBAUnderwritingPipeline(
    context: AgentContext
  ): Promise<AgentOrchestrationResult> {
    const agents: AgentName[] = [
      'sba_policy',
      'eligibility',
      'credit',
      'cash_flow',
      'collateral',
      'management',
      'risk',
      'narrative',
      'evidence',
    ];
    
    return this.executeAgents(agents, context);
  }
  
  /**
   * Topological sort of agents based on dependencies
   */
  private getExecutionOrder(agentNames: AgentName[]): AgentName[] {
    const visited = new Set<AgentName>();
    const order: AgentName[] = [];
    
    const visit = (name: AgentName) => {
      if (visited.has(name)) return;
      
      visited.add(name);
      
      // Visit dependencies first
      const deps = AGENT_DEPENDENCIES[name] || [];
      for (const dep of deps) {
        if (agentNames.includes(dep)) {
          visit(dep);
        }
      }
      
      order.push(name);
    };
    
    for (const name of agentNames) {
      visit(name);
    }
    
    return order;
  }
  
  /**
   * Get default input for an agent based on context and previous findings
   */
  private async getDefaultInput(
    agentName: AgentName,
    context: AgentContext,
    previousFindings: AgentFinding[]
  ): Promise<any> {
    // Base input always includes deal context
    const baseInput = {
      deal_id: context.deal_id,
      bank_id: context.bank_id,
    };
    
    // Agent-specific input construction
    switch (agentName) {
      case 'sba_policy':
        return {
          ...baseInput,
          loan_program: '7a', // TODO: Get from deal
        };
      
      case 'eligibility':
        return {
          ...baseInput,
          // Eligibility agent will query deal data directly
        };
      
      case 'credit':
        return {
          ...baseInput,
          // Credit agent will query borrower credit data
        };
      
      case 'cash_flow':
        const creditFindings = previousFindings.filter(f => f.agent_name === 'credit');
        return {
          ...baseInput,
          credit_context: creditFindings.map(f => f.output_json),
        };
      
      case 'risk':
        // Risk agent synthesizes all previous findings
        return {
          ...baseInput,
          all_findings: previousFindings,
        };
      
      case 'narrative':
        // Narrative agent uses all findings to generate memo
        return {
          ...baseInput,
          all_findings: previousFindings,
        };
      
      case 'evidence':
        const narrativeFindings = previousFindings.filter(f => f.agent_name === 'narrative');
        return {
          ...baseInput,
          narrative_findings: narrativeFindings.map(f => f.output_json),
        };
      
      default:
        return baseInput;
    }
  }
  
  /**
   * Get agent execution status for a deal
   */
  async getExecutionStatus(deal_id: string): Promise<{
    agent_name: AgentName;
    last_run: string | null;
    status: string;
    confidence: number | null;
  }[]> {
    const allAgents: AgentName[] = [
      'sba_policy',
      'eligibility',
      'credit',
      'cash_flow',
      'collateral',
      'management',
      'risk',
      'narrative',
      'evidence',
      'banker_copilot',
    ];
    
    const status = await Promise.all(
      allAgents.map(async (name) => {
        const agent = this.registry.get(name);
        
        if (!agent) {
          return {
            agent_name: name,
            last_run: null,
            status: 'not_registered',
            confidence: null,
          };
        }
        
        // Get latest finding
        const previous = await (agent as any).getPreviousFindings(deal_id, 1);
        
        if (previous.length === 0) {
          return {
            agent_name: name,
            last_run: null,
            status: 'not_run',
            confidence: null,
          };
        }
        
        const latest = previous[0];
        
        return {
          agent_name: name,
          last_run: latest.created_at || null,
          status: latest.status,
          confidence: latest.confidence,
        };
      })
    );
    
    return status;
  }
}

// Singleton orchestrator
export const orchestrator = new AgentOrchestrator();
