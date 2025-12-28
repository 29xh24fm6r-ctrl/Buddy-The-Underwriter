/**
 * Board-Ready Quarterly Risk Pack Generator
 * 
 * Generates comprehensive quarterly risk reports for board presentations.
 * AI-narrated, data-driven, regulator-grade.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/openai";

export async function generateBoardPack(bankId: string, quarter: string) {
  const sb = supabaseAdmin();

  // Gather quarterly data
  const quarterStart = getQuarterStartDate(quarter);
  const quarterEnd = getQuarterEndDate(quarter);

  // Portfolio snapshot
  const { data: portfolioSnapshot } = await sb
    .from("portfolio_risk_snapshots")
    .select("*")
    .eq("bank_id", bankId)
    .gte("as_of_date", quarterStart)
    .lte("as_of_date", quarterEnd)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Decision activity
  const { data: decisions } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("bank_id", bankId)
    .eq("status", "final")
    .gte("created_at", quarterStart)
    .lte("created_at", quarterEnd);

  // Stress test results
  const { data: stressTests } = await sb
    .from("stress_test_results")
    .select("*")
    .eq("bank_id", bankId)
    .gte("created_at", quarterStart)
    .lte("created_at", quarterEnd);

  // Policy drift findings
  const { data: driftFindings } = await sb
    .from("policy_drift_findings")
    .select("*")
    .eq("bank_id", bankId)
    .gte("created_at", quarterStart)
    .lte("created_at", quarterEnd);

  // Build metrics summary
  const metrics = {
    quarter,
    total_decisions: decisions?.length || 0,
    total_exposure: portfolioSnapshot?.total_exposure || 0,
    risk_weighted_assets: portfolioSnapshot?.risk_weighted_exposure || 0,
    exception_rate: portfolioSnapshot?.exception_rate || 0,
    committee_override_rate: portfolioSnapshot?.committee_override_rate || 0,
    stress_tests_run: stressTests?.length || 0,
    policy_drift_items: driftFindings?.length || 0
  };

  // Generate AI narrative
  const report = await aiJson({
    system: `You are a chief risk officer preparing a quarterly board presentation. 
Generate a professional, concise, and data-driven risk report (500-800 words).
Structure: Executive Summary, Key Metrics, Risk Trends, Policy Compliance, Recommendations.`,
    prompt: JSON.stringify({
      quarter,
      metrics,
      portfolio_snapshot: portfolioSnapshot,
      stress_test_summary: stressTests?.map(t => ({
        capital_at_risk: t.capital_at_risk,
        approvals_flipped: t.approvals_flipped_to_decline
      })),
      drift_summary: driftFindings?.map(d => ({
        rule: d.rule_key,
        drift_rate: d.drift_rate
      }))
    }),
    schema: {
      type: "object",
      properties: {
        content: { type: "string" }
      },
      required: ["content"]
    },
    timeout: 60000 // 60s for longer generation
  });

  // Store report
  await sb.from("board_risk_reports").upsert({
    bank_id: bankId,
    quarter,
    content: report.content,
    metrics_json: metrics
  });

  return {
    quarter,
    content: report.content,
    metrics
  };
}

function getQuarterStartDate(quarter: string): string {
  // quarter format: "2025-Q4"
  const [year, q] = quarter.split('-');
  const quarterNum = parseInt(q.replace('Q', ''));
  const month = (quarterNum - 1) * 3;
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

function getQuarterEndDate(quarter: string): string {
  // quarter format: "2025-Q4"
  const [year, q] = quarter.split('-');
  const quarterNum = parseInt(q.replace('Q', ''));
  const month = quarterNum * 3;
  const lastDay = new Date(parseInt(year), month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
}
