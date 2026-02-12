/**
 * Memo Engine — Section Builders
 *
 * Eight deterministic template-based section builders.
 * No LLM calls — all text is template-generated from structured data.
 *
 * PHASE 6: Pure functions — no DB, no side effects.
 */

import type { MemoInput, MemoSection } from "./types";
import { getRecommendation } from "./recommendation";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function fmt(value: number | undefined, fallback = "N/A"): string {
  if (value === undefined) return fallback;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtCurrency(value: number | undefined, fallback = "N/A"): string {
  if (value === undefined) return fallback;
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

// ---------------------------------------------------------------------------
// 1. Executive Summary
// ---------------------------------------------------------------------------

export function buildExecutiveSummary(input: MemoInput): MemoSection {
  const { product, policy, pricing, stress } = input;
  const rec = getRecommendation(policy.tier);

  const content = [
    `This credit memo presents the underwriting analysis for a ${product} facility.`,
    `The borrower has been assigned risk tier ${policy.tier} based on policy evaluation.`,
    `Recommendation: ${rec.text}`,
    `Proposed all-in rate: ${pct(pricing.finalRate)}.`,
    `Under stress testing, the worst-case tier is ${stress.worstTier}${stress.tierDegraded ? " (degraded from baseline)" : " (no degradation)"}.`,
  ].join(" ");

  return {
    key: "executiveSummary",
    title: "Executive Summary",
    content,
  };
}

// ---------------------------------------------------------------------------
// 2. Transaction Overview
// ---------------------------------------------------------------------------

export function buildTransactionOverview(input: MemoInput): MemoSection {
  const { dealId, product, snapshot } = input;

  const content = [
    `Deal ID: ${dealId}.`,
    `Product type: ${product}.`,
    `Analysis period: ${snapshot.period.type} ending ${snapshot.period.periodEnd}.`,
    `Data source: ${snapshot.debtService.diagnostics.source}.`,
  ].join(" ");

  const bullets = [
    `Period selection: ${snapshot.period.diagnostics.reason}`,
    `Candidates evaluated: ${snapshot.period.diagnostics.candidatePeriods.length}`,
  ];

  return {
    key: "transactionOverview",
    title: "Transaction Overview",
    content,
    bullets,
  };
}

// ---------------------------------------------------------------------------
// 3. Financial Analysis
// ---------------------------------------------------------------------------

export function buildFinancialAnalysis(input: MemoInput): MemoSection {
  const { analysis } = input;

  const metricLines: string[] = [];
  const km = analysis.keyMetrics;

  if (km.dscr !== undefined) metricLines.push(`DSCR: ${fmt(km.dscr)}`);
  if (km.leverage !== undefined) metricLines.push(`Leverage (Debt/EBITDA): ${fmt(km.leverage)}x`);
  if (km.currentRatio !== undefined) metricLines.push(`Current Ratio: ${fmt(km.currentRatio)}`);
  if (km.quickRatio !== undefined) metricLines.push(`Quick Ratio: ${fmt(km.quickRatio)}`);
  if (km.workingCapital !== undefined) metricLines.push(`Working Capital: ${fmtCurrency(km.workingCapital)}`);
  if (km.ebitdaMargin !== undefined) metricLines.push(`EBITDA Margin: ${pct(km.ebitdaMargin)}`);
  if (km.netMargin !== undefined) metricLines.push(`Net Margin: ${pct(km.netMargin)}`);

  const content = metricLines.length > 0
    ? `Key financial metrics for the ${analysis.product} analysis:\n${metricLines.join("\n")}`
    : "No financial metrics available for analysis.";

  const bullets: string[] = [];

  if (analysis.strengths.length > 0) {
    bullets.push(`Strengths: ${analysis.strengths.join("; ")}`);
  }
  if (analysis.weaknesses.length > 0) {
    bullets.push(`Weaknesses: ${analysis.weaknesses.join("; ")}`);
  }

  return {
    key: "financialAnalysis",
    title: "Financial Analysis",
    content,
    bullets: bullets.length > 0 ? bullets : undefined,
  };
}

// ---------------------------------------------------------------------------
// 4. Policy Assessment
// ---------------------------------------------------------------------------

export function buildPolicyAssessment(input: MemoInput): MemoSection {
  const { policy } = input;

  const status = policy.passed
    ? "All policy thresholds met."
    : `Policy evaluation failed on ${policy.failedMetrics.length} metric(s): ${policy.failedMetrics.join(", ")}.`;

  const breachLines = policy.breaches.map((b) => {
    const direction = b.threshold.minimum !== undefined ? "below minimum" : "above maximum";
    const thresholdVal = b.threshold.minimum ?? b.threshold.maximum;
    return `${b.metric}: ${fmt(b.actualValue)} (${direction} ${fmt(thresholdVal)}, ${b.severity} breach, ${pct(b.deviation)} deviation)`;
  });

  const content = [
    `Risk tier: ${policy.tier}. ${status}`,
    breachLines.length > 0 ? `\nBreaches:\n${breachLines.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("");

  const bullets = policy.warnings.length > 0
    ? policy.warnings.map((w) => `Warning: ${w}`)
    : undefined;

  return {
    key: "policyAssessment",
    title: "Policy Assessment",
    content,
    bullets,
  };
}

// ---------------------------------------------------------------------------
// 5. Stress Analysis
// ---------------------------------------------------------------------------

export function buildStressAnalysis(input: MemoInput): MemoSection {
  const { stress } = input;

  const scenarioLines = stress.scenarios.map((s) => {
    const tierNote = s.policy.tier !== stress.baseline.policy.tier
      ? ` (tier ${stress.baseline.policy.tier} → ${s.policy.tier})`
      : "";
    const dscrNote = s.dscrDelta !== undefined
      ? `, DSCR delta: ${s.dscrDelta >= 0 ? "+" : ""}${fmt(s.dscrDelta)}`
      : "";
    return `${s.label}: Tier ${s.policy.tier}${tierNote}${dscrNote}`;
  });

  const content = [
    `Stress testing evaluated ${stress.scenarios.length} scenario(s).`,
    `Worst-case tier: ${stress.worstTier}.`,
    stress.tierDegraded
      ? "Tier degradation detected under stress."
      : "No tier degradation under stress.",
    `\nScenarios:\n${scenarioLines.join("\n")}`,
  ].join(" ");

  return {
    key: "stressAnalysis",
    title: "Stress Analysis",
    content,
  };
}

// ---------------------------------------------------------------------------
// 6. Pricing Summary
// ---------------------------------------------------------------------------

export function buildPricingSummary(input: MemoInput): MemoSection {
  const { pricing } = input;

  const content = pricing.rationale.join("\n");

  const bullets = [
    `Base rate: ${pct(pricing.baseRate)}`,
    `Risk premium: +${pricing.riskPremiumBps}bps`,
    `Stress adjustment: +${pricing.stressAdjustmentBps}bps`,
    `Final rate: ${pct(pricing.finalRate)}`,
  ];

  return {
    key: "pricingSummary",
    title: "Pricing Summary",
    content,
    bullets,
  };
}

// ---------------------------------------------------------------------------
// 7. Risks and Mitigants
// ---------------------------------------------------------------------------

export function buildRisksAndMitigants(input: MemoInput): MemoSection {
  const { analysis } = input;

  const risks: string[] = [
    ...analysis.weaknesses,
    ...analysis.riskSignals,
    ...analysis.dataGaps.map((g) => `Data gap: ${g}`),
  ];

  const mitigants: string[] = [...analysis.strengths];

  const riskText = risks.length > 0
    ? `Identified risks:\n${risks.map((r) => `- ${r}`).join("\n")}`
    : "No material risks identified.";

  const mitigantText = mitigants.length > 0
    ? `\n\nMitigating factors:\n${mitigants.map((m) => `- ${m}`).join("\n")}`
    : "";

  return {
    key: "risksAndMitigants",
    title: "Risks and Mitigants",
    content: riskText + mitigantText,
  };
}

// ---------------------------------------------------------------------------
// 8. Recommendation
// ---------------------------------------------------------------------------

export function buildRecommendation(input: MemoInput): MemoSection {
  const { policy } = input;
  const rec = getRecommendation(policy.tier);

  let content = `Recommendation: ${rec.type.replace(/_/g, " ")}.\n\n${rec.text}`;

  if (policy.tier === "C") {
    content += "\n\nRecommended conditions:";
    content += "\n- Enhanced monitoring and quarterly financial reporting";
    content += "\n- Additional collateral or guarantor support as warranted";
    if (policy.breaches.length > 0) {
      content += `\n- Remediation plan for breached metrics: ${policy.failedMetrics.join(", ")}`;
    }
  }

  if (policy.tier === "D") {
    content += "\n\nDecline rationale:";
    content += `\n- ${policy.breaches.length} policy breach(es) detected`;
    for (const breach of policy.breaches) {
      content += `\n- ${breach.metric}: ${breach.severity} breach (${pct(breach.deviation)} deviation)`;
    }
  }

  return {
    key: "recommendation",
    title: "Recommendation",
    content,
  };
}
