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

type PortfolioClient = ReturnType<typeof supabaseAdmin>;

/**
 * Returns null when a bank has not produced a final decision yet. That is a
 * normal lifecycle state, not a failed nightly job. Database read/write
 * failures remain loud and are never collapsed into the empty state.
 */
export async function aggregatePortfolio(
  bankId: string,
  sb: PortfolioClient = supabaseAdmin(),
): Promise<PortfolioSnapshot | null> {
  const { data: snapshots, error: readError } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("bank_id", bankId)
    .eq("status", "final");

  if (readError) {
    throw new Error(
      `Portfolio decision read failed for bank ${bankId}: ${readError.message}`,
    );
  }

  if (!snapshots || snapshots.length === 0) {
    return null;
  }

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

    if (snap.committee_required === true) {
      committeeRequiredCount++;
    }
  }

  const totalDecisions = snapshots.length;
  const exceptionRate = decisionsWithExceptions / totalDecisions;
  const committeeOverrideRate = committeeRequiredCount / totalDecisions;

  const concentrationJson = {
    by_loan_size: calculateLoanSizeConcentration(snapshots),
    by_decision_type: calculateDecisionTypeConcentration(snapshots),
  };

  const snapshot: PortfolioSnapshot = {
    bank_id: bankId,
    as_of_date: new Date().toISOString().split("T")[0],
    total_exposure: totalExposure,
    risk_weighted_exposure: riskWeightedExposure,
    total_decisions: totalDecisions,
    decisions_with_exceptions: decisionsWithExceptions,
    exception_rate: exceptionRate,
    committee_required_count: committeeRequiredCount,
    committee_override_rate: committeeOverrideRate,
    concentration_json: concentrationJson,
  };

  const { error: writeError } = await sb
    .from("portfolio_risk_snapshots")
    .upsert(snapshot);

  if (writeError) {
    throw new Error(
      `Portfolio snapshot write failed for bank ${bankId}: ${writeError.message}`,
    );
  }

  return snapshot;
}

function calculateLoanSizeConcentration(
  snapshots: any[],
): Record<string, number> {
  const buckets = {
    "0-250k": 0,
    "250k-500k": 0,
    "500k-1M": 0,
    "1M-2M": 0,
    "2M+": 0,
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

function calculateDecisionTypeConcentration(
  snapshots: any[],
): Record<string, number> {
  const types = {
    approve: 0,
    decline: 0,
    refer: 0,
  };

  for (const snap of snapshots) {
    const decision = snap.decision || "unknown";
    if (decision.toLowerCase().includes("approve")) types.approve++;
    else if (decision.toLowerCase().includes("decline")) types.decline++;
    else if (decision.toLowerCase().includes("refer")) types.refer++;
  }

  return types;
}
