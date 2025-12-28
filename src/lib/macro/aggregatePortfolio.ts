/**
 * Portfolio Aggregation Engine
 * 
 * Aggregates all final decision snapshots into a system-wide
 * portfolio risk view. This is "the bank as a single entity."
 * 
 * Run nightly via cron/scheduled function.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export interface PortfolioSnapshot {
  bank_id: string;
  as_of_date: string;
  total_exposure: number;
  risk_weighted_exposure: number;
  total_decisions: number;
  decisions_with_exceptions: number;
  exception_rate: number;
  committee_required_count: number;
  committee_override_rate: number;
  concentration_json: Record<string, any>;
}

export async function aggregatePortfolio(bankId: string): Promise<PortfolioSnapshot> {
  const sb = supabaseAdmin();

  // Fetch all final decisions for this bank
  const { data: snapshots } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("bank_id", bankId)
    .eq("status", "final");

  if (!snapshots || snapshots.length === 0) {
    throw new Error("No final decisions found for portfolio aggregation");
  }

  // Aggregate metrics
  let totalExposure = 0;
  let riskWeightedExposure = 0;
  let decisionsWithExceptions = 0;
  let committeeRequiredCount = 0;

  for (const snap of snapshots) {
    const loanAmount = snap.inputs_json?.loan_amount || 0;
    const riskWeight = snap.model_json?.risk_weight || 1.0;
    
    totalExposure += loanAmount;
    riskWeightedExposure += loanAmount * riskWeight;
    
    if ((snap.exceptions_json?.length || 0) > 0) {
      decisionsWithExceptions++;
    }
    
    // Check if this decision required committee approval
    // (In a real implementation, check bank_credit_committee_policies)
    if (snap.committee_required === true) {
      committeeRequiredCount++;
    }
  }

  const totalDecisions = snapshots.length;
  const exceptionRate = decisionsWithExceptions / totalDecisions;
  const committeeOverrideRate = committeeRequiredCount / totalDecisions;

  // TODO: Calculate concentration metrics
  // - By industry (from borrower data)
  // - By loan size buckets
  // - By geography
  // - By underwriter
  const concentrationJson = {
    by_loan_size: calculateLoanSizeConcentration(snapshots),
    by_decision_type: calculateDecisionTypeConcentration(snapshots)
  };

  const snapshot: PortfolioSnapshot = {
    bank_id: bankId,
    as_of_date: new Date().toISOString().split('T')[0],
    total_exposure: totalExposure,
    risk_weighted_exposure: riskWeightedExposure,
    total_decisions: totalDecisions,
    decisions_with_exceptions: decisionsWithExceptions,
    exception_rate: exceptionRate,
    committee_required_count: committeeRequiredCount,
    committee_override_rate: committeeOverrideRate,
    concentration_json: concentrationJson
  };

  // Insert snapshot (upsert for idempotency)
  await sb.from("portfolio_risk_snapshots").upsert(snapshot);

  return snapshot;
}

function calculateLoanSizeConcentration(snapshots: any[]): Record<string, number> {
  const buckets = {
    "0-250k": 0,
    "250k-500k": 0,
    "500k-1M": 0,
    "1M-2M": 0,
    "2M+": 0
  };

  for (const snap of snapshots) {
    const amount = snap.inputs_json?.loan_amount || 0;
    if (amount < 250000) buckets["0-250k"]++;
    else if (amount < 500000) buckets["250k-500k"]++;
    else if (amount < 1000000) buckets["500k-1M"]++;
    else if (amount < 2000000) buckets["1M-2M"]++;
    else buckets["2M+"]++;
  }

  return buckets;
}

function calculateDecisionTypeConcentration(snapshots: any[]): Record<string, number> {
  const types = {
    approve: 0,
    decline: 0,
    refer: 0
  };

  for (const snap of snapshots) {
    const decision = snap.decision || "unknown";
    if (decision.toLowerCase().includes("approve")) types.approve++;
    else if (decision.toLowerCase().includes("decline")) types.decline++;
    else if (decision.toLowerCase().includes("refer")) types.refer++;
  }

  return types;
}
