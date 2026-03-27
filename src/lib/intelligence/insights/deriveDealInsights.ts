/**
 * Phase 60 — Deal Insight Derivation
 *
 * Read-only synthesis layer over existing systems.
 * Produces banker-facing decision view from:
 * - auto-intelligence state
 * - financial snapshot narrative
 * - risk pricing
 * - lender matches
 * - lifecycle blockers / next actions
 *
 * NO new orchestration. NO new persistence. Pure derivation.
 */

export type InsightItem = {
  code: string;
  label: string;
  detail: string | null;
  severity: "info" | "low" | "moderate" | "high" | "critical";
  category: "credit" | "process" | "structural" | "opportunity";
};

export type InsightNextAction = {
  label: string;
  href: string | null;
  serverAction: string | null;
  intent: "navigate" | "runnable" | "review";
};

export type DealInsightState = {
  status: "not_ready" | "ready" | "partial" | "attention_needed";
  summary: string;
  recommendation: string | null;
  risks: InsightItem[];
  mitigants: InsightItem[];
  opportunities: InsightItem[];
  blockers: InsightItem[];
  nextAction: InsightNextAction | null;
  evidence: {
    snapshotReady: boolean;
    lenderMatchReady: boolean;
    riskReady: boolean;
    lifecycleReady: boolean;
    intelligenceRunning: boolean;
  };
};

// ---------------------------------------------------------------------------
// Input types — pre-fetched from existing systems
// ---------------------------------------------------------------------------

export type InsightInput = {
  dealId: string;

  // From auto-intelligence pipeline
  intelligenceRunning: boolean;
  intelligenceReady: boolean;

  // From financial snapshot narrative
  snapshotExists: boolean;
  snapshotNarrative: {
    executiveSummary?: string | null;
    risks?: Array<{ label: string; detail?: string; severity?: string }>;
    mitigants?: Array<{ label: string; detail?: string }>;
    recommendation?: string | null;
  } | null;

  // From risk pricing
  riskPricingExists: boolean;
  riskPricingFinalized: boolean;
  riskGrade: string | null;
  riskScore: number | null;

  // From lender matching
  lenderMatchCount: number;
  lenderMatchReady: boolean;

  // From lifecycle
  lifecycleStage: string | null;
  lifecycleBlockers: Array<{ code: string; message: string }>;
  lifecycleNextAction: { label: string; href?: string; action?: string } | null;
};

/**
 * Derive banker-facing insight state from existing system outputs.
 * Pure function — no DB calls.
 */
export function deriveDealInsights(input: InsightInput): DealInsightState {
  const risks: InsightItem[] = [];
  const mitigants: InsightItem[] = [];
  const opportunities: InsightItem[] = [];
  const blockers: InsightItem[] = [];

  // ---------------------------------------------------------------------------
  // Risks — from snapshot narrative + risk pricing + lifecycle
  // ---------------------------------------------------------------------------

  if (input.snapshotNarrative?.risks) {
    for (const r of input.snapshotNarrative.risks) {
      risks.push({
        code: `snapshot_risk_${risks.length}`,
        label: r.label,
        detail: r.detail ?? null,
        severity: mapSeverity(r.severity),
        category: "credit",
      });
    }
  }

  if (input.riskPricingExists && !input.riskPricingFinalized) {
    risks.push({
      code: "risk_pricing_not_finalized",
      label: "Risk pricing not finalized",
      detail: "Risk pricing model exists but has not been reviewed and finalized by banker",
      severity: "moderate",
      category: "process",
    });
  }

  // Lifecycle blockers as process risks
  for (const b of input.lifecycleBlockers) {
    blockers.push({
      code: b.code,
      label: b.message,
      detail: null,
      severity: "high",
      category: "process",
    });
  }

  // ---------------------------------------------------------------------------
  // Mitigants — from snapshot narrative
  // ---------------------------------------------------------------------------

  if (input.snapshotNarrative?.mitigants) {
    for (const m of input.snapshotNarrative.mitigants) {
      mitigants.push({
        code: `snapshot_mitigant_${mitigants.length}`,
        label: m.label,
        detail: m.detail ?? null,
        severity: "info",
        category: "credit",
      });
    }
  }

  if (input.snapshotExists) {
    mitigants.push({
      code: "snapshot_complete",
      label: "Financial snapshot is complete",
      detail: "Required spreads and snapshot have been generated",
      severity: "info",
      category: "process",
    });
  }

  // ---------------------------------------------------------------------------
  // Opportunities — from lender matches + risk tier + structure
  // ---------------------------------------------------------------------------

  if (input.lenderMatchCount > 0) {
    opportunities.push({
      code: "lender_matches",
      label: `${input.lenderMatchCount} lender${input.lenderMatchCount !== 1 ? "s" : ""} matched this structure`,
      detail: "Appetite indicators suggest viable placement options",
      severity: "info",
      category: "opportunity",
    });
  }

  if (input.riskGrade && ["A", "B"].includes(input.riskGrade.toUpperCase())) {
    opportunities.push({
      code: "favorable_risk_tier",
      label: `Risk grade ${input.riskGrade} — favorable tier`,
      detail: "Deal risk profile supports competitive pricing",
      severity: "info",
      category: "opportunity",
    });
  }

  if (blockers.length === 0 && input.snapshotExists && input.riskPricingFinalized) {
    opportunities.push({
      code: "advance_ready",
      label: "Deal may be ready to advance to pricing or memo",
      detail: "No active blockers, snapshot complete, risk pricing finalized",
      severity: "info",
      category: "opportunity",
    });
  }

  // ---------------------------------------------------------------------------
  // Status derivation
  // ---------------------------------------------------------------------------

  let status: DealInsightState["status"];
  if (input.intelligenceRunning) {
    status = "partial";
  } else if (blockers.length > 0) {
    status = "attention_needed";
  } else if (input.snapshotExists && input.lenderMatchReady && input.riskPricingExists) {
    status = "ready";
  } else if (input.snapshotExists || input.lenderMatchReady) {
    status = "partial";
  } else {
    status = "not_ready";
  }

  // ---------------------------------------------------------------------------
  // Summary — one deterministic sentence
  // ---------------------------------------------------------------------------

  const summary = buildSummary(input, status, risks.length, blockers.length, input.lenderMatchCount);

  // ---------------------------------------------------------------------------
  // Recommendation — priority: lifecycle > snapshot > lender > fallback
  // ---------------------------------------------------------------------------

  let recommendation: string | null = null;
  if (input.lifecycleNextAction) {
    recommendation = input.lifecycleNextAction.label;
  } else if (input.snapshotNarrative?.recommendation) {
    recommendation = input.snapshotNarrative.recommendation;
  } else if (input.lenderMatchCount > 0 && !input.riskPricingFinalized) {
    recommendation = "Finalize risk pricing to unlock lender placement";
  }

  // ---------------------------------------------------------------------------
  // Next action — from lifecycle primarily
  // ---------------------------------------------------------------------------

  let nextAction: InsightNextAction | null = null;
  if (input.lifecycleNextAction) {
    nextAction = {
      label: input.lifecycleNextAction.label,
      href: input.lifecycleNextAction.href ?? null,
      serverAction: input.lifecycleNextAction.action ?? null,
      intent: input.lifecycleNextAction.action ? "runnable" : "navigate",
    };
  }

  return {
    status,
    summary,
    recommendation,
    risks,
    mitigants,
    opportunities,
    blockers,
    nextAction,
    evidence: {
      snapshotReady: input.snapshotExists,
      lenderMatchReady: input.lenderMatchReady,
      riskReady: input.riskPricingExists,
      lifecycleReady: blockers.length === 0,
      intelligenceRunning: input.intelligenceRunning,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSeverity(raw?: string): InsightItem["severity"] {
  if (!raw) return "moderate";
  const lower = raw.toLowerCase();
  if (lower === "critical" || lower === "high") return "high";
  if (lower === "moderate" || lower === "medium") return "moderate";
  if (lower === "low") return "low";
  return "info";
}

function buildSummary(
  input: InsightInput,
  status: string,
  riskCount: number,
  blockerCount: number,
  lenderCount: number,
): string {
  if (status === "not_ready") {
    return "Analysis is incomplete — financial snapshot and risk evaluation are still pending.";
  }

  if (input.intelligenceRunning) {
    return "Buddy is still analyzing this deal. Insights will update as steps complete.";
  }

  const parts: string[] = [];

  if (input.snapshotNarrative?.executiveSummary) {
    // Use first sentence of snapshot executive summary
    const first = input.snapshotNarrative.executiveSummary.split(/[.!?]/)[0];
    if (first && first.length > 10) parts.push(first.trim());
  }

  if (riskCount > 0 && blockerCount > 0) {
    parts.push(`${riskCount} risk signal${riskCount !== 1 ? "s" : ""} and ${blockerCount} blocker${blockerCount !== 1 ? "s" : ""} require attention`);
  } else if (riskCount > 0) {
    parts.push(`${riskCount} risk signal${riskCount !== 1 ? "s" : ""} identified`);
  } else if (blockerCount > 0) {
    parts.push(`${blockerCount} process blocker${blockerCount !== 1 ? "s" : ""} remain`);
  }

  if (lenderCount > 0) {
    parts.push(`${lenderCount} lender${lenderCount !== 1 ? "s" : ""} matched`);
  }

  if (parts.length === 0) {
    return status === "ready"
      ? "Deal analysis is complete with no outstanding issues."
      : "Analysis is in progress.";
  }

  return parts.join(". ") + ".";
}
