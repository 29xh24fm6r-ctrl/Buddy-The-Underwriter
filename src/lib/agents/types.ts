/**
 * SBA God Mode: Agent System Types
 * 
 * Defines the contract for all AI agents in the SBA underwriting swarm.
 * Each agent is autonomous but follows strict input/output schemas.
 */

export type AgentName =
  | 'sba_policy'
  | 'eligibility'
  | 'credit'
  | 'cash_flow'
  | 'collateral'
  | 'management'
  | 'risk'
  | 'narrative'
  | 'evidence'
  | 'banker_copilot';

export type FindingStatus = 'pass' | 'fail' | 'conditional' | 'pending' | 'override';

export type FindingType = 'requirement' | 'risk' | 'recommendation' | 'narrative' | 'evidence' | 'question';

/**
 * Core output structure for all agents
 */
export interface AgentFinding {
  id?: string;
  deal_id: string;
  bank_id: string;
  agent_name: AgentName;
  agent_version: string;
  finding_type: FindingType;
  status: FindingStatus;
  confidence: number; // 0.00 to 1.00
  input_json: Record<string, any>;
  output_json: Record<string, any>;
  evidence_json?: Record<string, any>;
  requires_human_review: boolean;
  human_override?: boolean;
  override_reason?: string;
  override_by?: string;
  override_at?: string;
  created_at?: string;
  updated_at?: string;
  expires_at?: string;
}

/**
 * Agent execution context
 */
export interface AgentContext {
  deal_id: string;
  bank_id: string;
  user_id?: string;
  session_id?: string;
  force_refresh?: boolean; // Bypass caching
  explain?: boolean; // Include detailed explanations
}

/**
 * SBA Policy Agent Output
 */
export interface SBAPolicyFinding {
  rule_id: string; // e.g., "SOP_50_10_6_B_2"
  requirement: string;
  status: FindingStatus;
  citation: string; // SOP reference
  explanation: string;
  confidence: number;
  related_rules?: string[];
}

/**
 * Eligibility Agent Output
 */
export interface EligibilityFinding {
  check_name: string; // "business_size" | "use_of_proceeds" | "citizenship" | "franchise" | "ineligible_business"
  eligible: boolean;
  reason: string;
  mitigation_options?: string[];
  sop_citation?: string;
}

/**
 * Credit Agent Output
 */
export interface CreditFinding {
  borrower_id: string;
  borrower_name: string;
  credit_score?: number;
  derogatories: {
    type: string; // "bankruptcy" | "tax_lien" | "judgment" | "delinquency"
    date: string;
    amount?: number;
    status: string; // "open" | "closed" | "paid"
    explanation?: string;
  }[];
  sba_impact: 'fatal' | 'mitigable' | 'none';
  mitigation_options: string[];
  summary: string;
}

/**
 * Cash Flow Agent Output
 */
export interface CashFlowFinding {
  year: number;
  net_income: number;
  adjustments: {
    label: string; // "Depreciation" | "Interest" | "Owner Compensation"
    amount: number;
    justification: string;
  }[];
  adjusted_cash_flow: number;
  debt_service: number;
  dscr: number;
  global_dscr?: number;
  pass: boolean;
  explanation: string;
}

/**
 * Collateral Agent Output
 */
export interface CollateralFinding {
  collateral_types: {
    type: string; // "real_estate" | "equipment" | "inventory" | "ar"
    description: string;
    estimated_value: number;
    lien_position: number;
  }[];
  total_collateral_value: number;
  loan_amount: number;
  shortfall: boolean;
  shortfall_amount?: number;
  sop_compliant: boolean;
  explanation: string;
}

/**
 * Management Agent Output
 */
export interface ManagementFinding {
  principal_name: string;
  years_experience: number;
  industry_match: boolean;
  relevance_score: number; // 0.00 to 1.00
  key_strengths: string[];
  concerns: string[];
  narrative_paragraph: string;
}

/**
 * Risk Synthesis Agent Output (The Orchestrator)
 */
export interface RiskSynthesisFinding {
  overall_risk: 'low' | 'moderate' | 'high' | 'severe';
  overall_confidence: number;
  top_5_risks: {
    risk: string;
    severity: 'low' | 'moderate' | 'high';
    mitigation?: string;
  }[];
  mitigations: string[];
  recommend_approve: boolean;
  conditions: string[];
  executive_summary: string;
  agent_consensus: {
    agent_name: AgentName;
    vote: 'approve' | 'decline' | 'conditional';
    confidence: number;
  }[];
}

/**
 * Narrative Agent Output
 */
export interface NarrativeFinding {
  section: string; // "business_overview" | "loan_request" | "use_of_proceeds" | "repayment_analysis" | "eligibility" | "risk_mitigants"
  content: string; // Full markdown text
  evidence_references: {
    claim: string;
    document_id: string;
    page?: number;
    bounding_box?: { x: number; y: number; w: number; h: number };
  }[];
}

/**
 * Evidence Agent Output
 */
export interface EvidenceFinding {
  claim: string;
  verified: boolean;
  source_documents: {
    document_id: string;
    file_name: string;
    page: number;
    excerpt: string;
    confidence: number;
  }[];
  explanation: string;
}

/**
 * Banker Copilot Output
 */
export interface BankerCopilotFinding {
  question: string;
  answer: string;
  confidence: number;
  related_agents: AgentName[];
  sop_citations?: string[];
  suggested_actions?: string[];
}

/**
 * Base agent interface
 */
export interface BaseAgent<TInput = any, TOutput = any> {
  name: AgentName;
  version: string;
  description: string;
  
  /**
   * Execute the agent's analysis
   */
  execute(input: TInput, context: AgentContext): Promise<TOutput>;
  
  /**
   * Validate input before execution
   */
  validateInput(input: TInput): { valid: boolean; error?: string };
  
  /**
   * Calculate confidence score
   */
  calculateConfidence(output: TOutput, input: TInput): number;
  
  /**
   * Determine if human review is needed
   */
  requiresHumanReview(output: TOutput): boolean;
}

/**
 * Agent orchestration result
 */
export interface AgentOrchestrationResult {
  deal_id: string;
  bank_id: string;
  session_id: string;
  agents_executed: AgentName[];
  findings: AgentFinding[];
  errors: {
    agent_name: AgentName;
    error: string;
  }[];
  execution_time_ms: number;
  overall_confidence: number;
}
