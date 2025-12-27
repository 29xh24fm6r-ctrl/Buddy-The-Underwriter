/**
 * SBA God Mode: Borrower Readiness Score
 * 
 * Calculates a borrower-visible progress score from deal truth + missing items.
 * This is NOT a promise of approval, but a progress proxy.
 */

export interface ReadinessScore {
  overall_score: number; // 0.00 to 1.00
  label: string; // "Getting started", "Building the file", etc.
  components: {
    sba_eligibility: number;
    required_docs_present: number;
    required_docs_verified: number;
    cash_flow_complete: number;
    credit_complete: number;
    evidence_coverage: number;
  };
  milestones: {
    '25': boolean; // Getting started
    '50': boolean; // Building the file
    '75': boolean; // Underwriter-ready
    '100': boolean; // E-Tran ready 🎉
  };
  next_best_action: NextBestAction | null;
  blockers: string[];
  gates_applied: Array<{ condition: string; cap: number }>;
}

export interface NextBestAction {
  type: 'upload_document' | 'complete_profile' | 'verify_identity' | 'answer_question' | 'wait_for_review';
  title: string;
  description: string;
  eta_minutes: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

/**
 * E-Tran Ready Component Weights (must sum to 1.0)
 * Based on what actually matters for SBA submission
 */
const ETRAN_READY_WEIGHTS = {
  sba_eligibility: 0.25,           // Hard gates (business size, ineligible industries)
  required_docs_present: 0.20,     // All required docs uploaded
  required_docs_verified: 0.20,    // Docs OCR'd and validated
  cash_flow_complete: 0.15,        // DSCR calculated, tax returns analyzed
  credit_complete: 0.10,           // Credit pull + analysis
  evidence_coverage: 0.10,         // All claims backed by evidence
};

/**
 * Connected Accounts Readiness Boost
 * Additional boost for connected data sources (applied after base score)
 */
const CONNECTED_ACCOUNT_BOOSTS = {
  plaid_bank: 0.15,                // +15% for connected bank accounts
  quickbooks_online: 0.20,         // +20% for connected accounting
  quickbooks_desktop: 0.20,
  xero: 0.20,
  irs_transcript: 0.25,            // +25% for IRS transcript (most valuable)
  gusto: 0.05,                     // +5% for payroll
  adp: 0.05,
  paychex: 0.05,
};

/**
 * Calculate E-Tran Ready score
 */
export async function calculateReadinessScore(
  dealId: string,
  bankId: string
): Promise<ReadinessScore> {
  // Component scores (0-1)
  const components = {
    sba_eligibility: await calculateEligibilityScore(dealId, bankId),
    required_docs_present: await calculateDocsPresent(dealId),
    required_docs_verified: await calculateDocsVerified(dealId),
    cash_flow_complete: await calculateCashFlowScore(dealId),
    credit_complete: await calculateCreditScore(dealId),
    evidence_coverage: await calculateEvidenceScore(dealId, bankId),
  };
  
  // Weighted overall score
  let overallScore = 0;
  for (const [key, weight] of Object.entries(ETRAN_READY_WEIGHTS)) {
    overallScore += components[key as keyof typeof components] * weight;
  }
  
  // Apply connected accounts boost
  const connectionBoost = await calculateConnectionBoost(dealId, bankId);
  overallScore += connectionBoost;
  
  // Apply gates (hard caps based on conditions)
  const gatesApplied: Array<{ condition: string; cap: number }> = [];
  
  // Gate 1: Eligibility failure caps at 20%
  const eligibilityGate = await checkEligibilityGate(dealId, bankId);
  if (!eligibilityGate.pass) {
    overallScore = Math.min(overallScore, 0.20);
    gatesApplied.push({ condition: "Eligibility issues present", cap: 0.20 });
  }
  
  // Gate 2: Open conflicts cap at 70%
  const openConflicts = await checkOpenConflicts(dealId, bankId);
  if (openConflicts.count > 0) {
    overallScore = Math.min(overallScore, 0.70);
    gatesApplied.push({ condition: `${openConflicts.count} conflicts need review`, cap: 0.70 });
  }
  
  // Determine label
  const label = getReadinessLabel(overallScore);
  
  // Milestones
  const milestones = {
    '25': overallScore >= 0.25,
    '50': overallScore >= 0.50,
    '75': overallScore >= 0.75,
    '100': overallScore >= 1.00,
  };
  
  // Identify next best action
  const nextBestAction = determineNextBestAction(components, eligibilityGate, openConflicts);
  
  // Identify blockers
  const blockers: string[] = [];
  if (!eligibilityGate.pass) {
    blockers.push(...eligibilityGate.issues);
  }
  if (openConflicts.count > 0) {
    blockers.push(...openConflicts.issues);
  }
  
  return {
    overall_score: Math.min(Math.max(overallScore, 0), 1),
    label,
    components,
    milestones,
    next_best_action: nextBestAction,
    blockers,
    gates_applied: gatesApplied,
  };
}

/**
 * Calculate SBA eligibility score
 */
async function calculateEligibilityScore(dealId: string, bankId: string): Promise<number> {
  // TODO: Query arbitration decisions for eligibility topic
  // Check for blocker failures
  return 1.0; // Placeholder
}

/**
 * Calculate required docs present score
 */
async function calculateDocsPresent(dealId: string): Promise<number> {
  // TODO: Query borrower_files and compare to required_documents
  // Score = uploaded / required
  return 0.7; // Placeholder
}

/**
 * Calculate required docs verified score
 */
async function calculateDocsVerified(dealId: string): Promise<number> {
  // TODO: Check borrower_files.status = 'verified'
  // Score = verified / required
  return 0.6; // Placeholder
}

/**
 * Calculate cash flow completeness
 */
async function calculateCashFlowScore(dealId: string): Promise<number> {
  // TODO: Check if DSCR calculated, tax returns analyzed
  // Return 1.0 if cash_flow agent has high confidence
  return 0.8; // Placeholder
}

/**
 * Calculate credit completeness
 */
async function calculateCreditScore(dealId: string): Promise<number> {
  // TODO: Check if credit pull complete
  // Return 1.0 if credit agent has completed
  return 0.5; // Placeholder
}

/**
 * Calculate evidence coverage score
 */
async function calculateEvidenceScore(dealId: string, bankId: string): Promise<number> {
  // TODO: Check % of claims backed by evidence
  // Query evidence agent findings
  return 0.7; // Placeholder
}

/**
 * Check eligibility gate (hard stop)
 */
async function checkEligibilityGate(
  dealId: string,
  bankId: string
): Promise<{ pass: boolean; issues: string[] }> {
  // TODO: Query arbitration_decisions for eligibility topic
  // If any eligibility claim has severity=blocker and status=fail, gate fails
  return {
    pass: true,
    issues: [],
  }; // Placeholder
}

/**
 * Check for open conflicts
 */
async function checkOpenConflicts(
  dealId: string,
  bankId: string
): Promise<{ count: number; issues: string[] }> {
  // TODO: Query claim_conflict_sets with status = 'open'
  return {
    count: 0,
    issues: [],
  }; // Placeholder
}

/**
 * Get readiness label
 */
function getReadinessLabel(score: number): string {
  if (score >= 1.0) return "E-Tran ready 🎉";
  if (score >= 0.75) return "Almost E-Tran ready";
  if (score >= 0.50) return "Underwriter-ready";
  if (score >= 0.25) return "Building the file";
  return "Getting started";
}

/**
 * Determine next best action for borrower
 */
function determineNextBestAction(
  components: ReadinessScore['components'],
  eligibilityGate: { pass: boolean; issues: string[] },
  openConflicts: { count: number; issues: string[] }
): NextBestAction | null {
  // Priority order:
  // 1. Fix eligibility issues (critical)
  // 2. Resolve open conflicts (high)
  // 3. Upload missing docs (high)
  // 4. Wait for verification (low)
  
  if (!eligibilityGate.pass) {
    return {
      type: 'answer_question',
      title: 'Resolve eligibility issues',
      description: eligibilityGate.issues[0] || 'We need to fix some eligibility requirements',
      eta_minutes: 10,
      priority: 'critical',
    };
  }
  
  if (openConflicts.count > 0) {
    return {
      type: 'answer_question',
      title: 'Review requested',
      description: 'Our underwriter needs clarification on a few items',
      eta_minutes: 15,
      priority: 'high',
    };
  }
  
  if (components.required_docs_present < 0.8) {
    return {
      type: 'upload_document',
      title: 'Upload 2023 tax return',
      description: 'We need your most recent business tax return',
      eta_minutes: 3,
      priority: 'high',
    };
  }
  
  if (components.required_docs_verified < 0.9) {
    return {
      type: 'wait_for_review',
      title: 'We\'re reviewing your documents',
      description: 'Our team is verifying your uploads. This usually takes 1-2 business days.',
      eta_minutes: 1440, // 1 day
      priority: 'low',
    };
  }
  
  return null;
}

/**
 * Get milestone message for celebration
 */
export function getMilestoneMessage(milestone: '25' | '50' | '75' | '100'): string {
  const messages = {
    '25': 'Nice — you\'ve started! 🎉',
    '50': 'Halfway there — big stuff done! 🚀',
    '75': 'Almost underwriter-ready! 💪',
    '100': 'Package ready for E-Tran! 🎊',
  };
  
  return messages[milestone];
}

/**
 * Calculate readiness boost from connected accounts
 */
async function calculateConnectionBoost(dealId: string, bankId: string): Promise<number> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();
  
  const { data: connections } = await sb
    .from("borrower_account_connections")
    .select("connection_type")
    .eq("deal_id", dealId)
    .eq("status", "active");
  
  if (!connections || connections.length === 0) {
    return 0;
  }
  
  // Apply boosts (max once per connection type)
  const uniqueTypes = new Set(connections.map(c => c.connection_type));
  let totalBoost = 0;
  
  for (const type of uniqueTypes) {
    const boost = CONNECTED_ACCOUNT_BOOSTS[type as keyof typeof CONNECTED_ACCOUNT_BOOSTS];
    if (boost) {
      totalBoost += boost;
    }
  }
  
  return totalBoost;
}
