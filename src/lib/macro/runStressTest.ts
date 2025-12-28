/**
 * Stress Testing Engine
 * 
 * Replays historical decisions under shock scenarios.
 * This is the "what breaks under stress?" analysis.
 * 
 * Example scenarios:
 * - "DSCR deteriorates 20%"
 * - "LTV increases 10%"
 * - "Loan amounts drop 10% (demand shock)"
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface StressTestScenario {
  id: string;
  bank_id: string;
  name: string;
  description?: string;
  shock_json: {
    dscr_delta?: number;      // e.g., -0.2 (20% deterioration)
    ltv_delta?: number;        // e.g., 0.1 (10% increase)
    loan_amount_multiplier?: number; // e.g., 0.9 (10% reduction)
    collateral_multiplier?: number;  // e.g., 0.85 (15% haircut)
  };
}

export interface StressTestResult {
  scenario_id: string;
  bank_id: string;
  total_deals_tested: number;
  approvals_flipped_to_decline: number;
  declines_flipped_to_approval: number;
  capital_at_risk: number;
  results_json: Array<{
    deal_id: string;
    original_decision: string;
    stressed_decision: string;
    risk_delta: number;
  }>;
}

export async function runStressTest(scenarioId: string): Promise<StressTestResult> {
  const sb = supabaseAdmin();

  // Fetch scenario
  const { data: scenario, error: scenarioError } = await sb
    .from("stress_test_scenarios")
    .select("*")
    .eq("id", scenarioId)
    .single();

  if (scenarioError || !scenario) {
    throw new Error("Stress test scenario not found");
  }

  // Fetch all final decisions for this bank
  const { data: snapshots } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("bank_id", scenario.bank_id)
    .eq("status", "final");

  if (!snapshots || snapshots.length === 0) {
    throw new Error("No final decisions found for stress testing");
  }

  // Apply shocks and evaluate
  let approvalsFlipped = 0;
  let declinesFlipped = 0;
  let capitalAtRisk = 0;
  const results: Array<{
    deal_id: string;
    original_decision: string;
    stressed_decision: string;
    risk_delta: number;
  }> = [];

  for (const snap of snapshots) {
    const originalDecision = snap.decision || "unknown";
    const loanAmount = snap.inputs_json?.loan_amount || 0;
    
    // Apply shocks
    const shockedDscr = applyDscrShock(
      snap.policy_eval_json?.dscr || 0,
      scenario.shock_json?.dscr_delta || 0
    );
    
    const shockedLtv = applyLtvShock(
      snap.policy_eval_json?.ltv || 0,
      scenario.shock_json?.ltv_delta || 0
    );

    // Simple decision flip logic (would use full decision engine in production)
    const stressedDecision = evaluateStressedDecision(
      originalDecision,
      shockedDscr,
      shockedLtv,
      snap.policy_eval_json
    );

    // Track flips
    if (originalDecision.toLowerCase().includes("approve") && 
        stressedDecision.toLowerCase().includes("decline")) {
      approvalsFlipped++;
      capitalAtRisk += loanAmount;
    } else if (originalDecision.toLowerCase().includes("decline") && 
               stressedDecision.toLowerCase().includes("approve")) {
      declinesFlipped++;
    }

    results.push({
      deal_id: snap.deal_id,
      original_decision: originalDecision,
      stressed_decision: stressedDecision,
      risk_delta: stressedDecision !== originalDecision ? loanAmount : 0
    });
  }

  const result: StressTestResult = {
    scenario_id: scenarioId,
    bank_id: scenario.bank_id,
    total_deals_tested: snapshots.length,
    approvals_flipped_to_decline: approvalsFlipped,
    declines_flipped_to_approval: declinesFlipped,
    capital_at_risk: capitalAtRisk,
    results_json: results
  };

  // Insert result
  await sb.from("stress_test_results").insert(result);

  return result;
}

function applyDscrShock(baseDscr: number, delta: number): number {
  return Math.max(0, baseDscr + delta);
}

function applyLtvShock(baseLtv: number, delta: number): number {
  return Math.min(1, Math.max(0, baseLtv + delta));
}

function evaluateStressedDecision(
  originalDecision: string,
  shockedDscr: number,
  shockedLtv: number,
  policyEval: any
): string {
  // Simplified logic (production would replay full decision engine)
  
  // Critical thresholds (would come from policy)
  const minDscr = 1.0;
  const maxLtv = 0.9;

  if (shockedDscr < minDscr || shockedLtv > maxLtv) {
    return "decline (stress scenario)";
  }

  return originalDecision;
}
