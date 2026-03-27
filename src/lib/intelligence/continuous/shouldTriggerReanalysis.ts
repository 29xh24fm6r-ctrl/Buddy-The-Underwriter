/**
 * Phase 61 — Continuous Intelligence Trigger Decision
 *
 * Pure function. Determines whether an event warrants re-analysis
 * and what scope of recomputation is needed.
 *
 * Rules:
 * - Financial doc finalized → full pipeline
 * - Spread completed → full pipeline
 * - Research completed → full pipeline
 * - Snapshot generated (no upstream fact change) → insights only
 * - Critical flag changed → insights only
 * - Non-financial doc → suppress
 */

export type ContinuousEvent =
  | { type: "document_finalized"; dealId: string; documentId: string; checklistKey?: string | null; isFinancial?: boolean }
  | { type: "spread_completed"; dealId: string; spreadJobId: string }
  | { type: "snapshot_generated"; dealId: string; snapshotId: string; upstreamFactsChanged?: boolean }
  | { type: "research_completed"; dealId: string; missionId: string }
  | { type: "critical_flag_changed"; dealId: string; flagId: string; status: string };

export type ReanalysisScope = "full_pipeline" | "facts_only" | "insights_only";

export type ReanalysisDecision = {
  shouldTrigger: boolean;
  reason: string;
  debounceKey: string;
  scope: ReanalysisScope;
};

const FINANCIAL_CHECKLIST_KEYS = new Set([
  "BUSINESS_TAX_RETURN", "PERSONAL_TAX_RETURN", "INCOME_STATEMENT", "BALANCE_SHEET",
  "RENT_ROLL", "PERSONAL_FINANCIAL_STATEMENT", "BANK_STATEMENT", "T12",
  "TAX_RETURN_BUSINESS", "TAX_RETURN_PERSONAL", "FINANCIAL_STATEMENT",
]);

/**
 * Determine whether an event should trigger re-analysis.
 */
export function shouldTriggerReanalysis(event: ContinuousEvent): ReanalysisDecision {
  switch (event.type) {
    case "document_finalized": {
      const isFinancial = event.isFinancial ??
        (event.checklistKey ? FINANCIAL_CHECKLIST_KEYS.has(event.checklistKey.toUpperCase()) : false);

      if (!isFinancial) {
        return {
          shouldTrigger: false,
          reason: "Non-financial document — no re-analysis needed",
          debounceKey: `doc_${event.dealId}`,
          scope: "insights_only",
        };
      }

      return {
        shouldTrigger: true,
        reason: "Financial document finalized — facts may have changed",
        debounceKey: `doc_financial_${event.dealId}`,
        scope: "full_pipeline",
      };
    }

    case "spread_completed":
      return {
        shouldTrigger: true,
        reason: "Spread completed — financial facts may have changed",
        debounceKey: `spread_${event.dealId}`,
        scope: "full_pipeline",
      };

    case "snapshot_generated": {
      if (event.upstreamFactsChanged === false) {
        return {
          shouldTrigger: true,
          reason: "Snapshot generated without upstream fact changes — refresh insights only",
          debounceKey: `snapshot_${event.dealId}`,
          scope: "insights_only",
        };
      }
      return {
        shouldTrigger: true,
        reason: "Snapshot generated with upstream changes — full re-analysis",
        debounceKey: `snapshot_${event.dealId}`,
        scope: "full_pipeline",
      };
    }

    case "research_completed":
      return {
        shouldTrigger: true,
        reason: "Research mission completed — may unlock pricing/decision readiness",
        debounceKey: `research_${event.dealId}`,
        scope: "full_pipeline",
      };

    case "critical_flag_changed":
      return {
        shouldTrigger: true,
        reason: `Critical flag ${event.status} — lifecycle/insight posture may change`,
        debounceKey: `flag_${event.dealId}`,
        scope: "insights_only",
      };
  }
}
