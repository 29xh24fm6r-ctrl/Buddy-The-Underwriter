/**
 * SBA God Mode: Agent System Exports
 * 
 * Central export point for all agents and orchestration.
 */

// Types
export * from './types';

// Base classes
export { Agent } from './base';
export { AgentOrchestrator, orchestrator, agentRegistry } from './orchestrator';

// Individual agents
export { SBAPolicyAgent } from './sba-policy';
export { EligibilityAgent } from './eligibility';
export { CashFlowAgent } from './cash-flow';
export { RiskSynthesisAgent } from './risk';

// Agent registration
import { agentRegistry } from './orchestrator';
import { SBAPolicyAgent } from './sba-policy';
import { EligibilityAgent } from './eligibility';
import { CashFlowAgent } from './cash-flow';
import { RiskSynthesisAgent } from './risk';

// Register all agents on import
if (typeof window === 'undefined') {
  // Server-side only
  agentRegistry.register(new SBAPolicyAgent());
  agentRegistry.register(new EligibilityAgent());
  agentRegistry.register(new CashFlowAgent());
  agentRegistry.register(new RiskSynthesisAgent());
}
