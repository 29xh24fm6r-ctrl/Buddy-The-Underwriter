/**
 * Phase 55E — Financial Exception Builder
 *
 * Normalizes gate state, gap queue, and resolution audit into
 * a unified FinancialException[] with severity, narrative, and
 * committee disclosure.
 *
 * Pure function — accepts pre-fetched data.
 */

import type { FinancialException, ExceptionKind } from "./exception-types";
import { categorizeFactKey, scoreExceptionSeverity, scoreDecisionImpact, isDecisionCriticalCategory } from "./scoreFinancialException";
import { buildExceptionNarrative } from "./buildExceptionNarrative";

type GapInput = {
  id: string;
  gapType: "missing_fact" | "conflict" | "low_confidence";
  factKey: string;
  factId: string | null;
  status: "open" | "resolved";
  description: string;
};

type ResolutionInput = {
  id: string;
  gapId: string;
  action: string;
  factKey: string;
  priorValue: number | null;
  resolvedValue: number | null;
  rationale: string | null;
  resolvedAt: string;
};

type BuildInput = {
  dealId: string;
  gaps: GapInput[];
  resolutions: ResolutionInput[];
  snapshotStale: boolean;
  isPostMemo: boolean;
  materialChangesAfterMemo: string[];
};

const GAP_TO_KIND: Record<string, ExceptionKind> = {
  missing_fact: "missing_critical_metric",
  conflict: "unresolved_conflict",
  low_confidence: "low_confidence_required_fact",
};

const ACTION_TO_KIND: Record<string, ExceptionKind> = {
  override_value: "banker_override",
  provide_value: "manual_provided_value",
  mark_follow_up: "deferred_follow_up",
};

/**
 * Build classified financial exceptions from raw inputs.
 */
export function buildFinancialExceptions(input: BuildInput): FinancialException[] {
  const exceptions: FinancialException[] = [];
  let counter = 0;

  // 1. Open gaps → exceptions
  for (const gap of input.gaps.filter((g) => g.status === "open")) {
    const kind = GAP_TO_KIND[gap.gapType] ?? "low_confidence_required_fact";
    const category = categorizeFactKey(gap.factKey);
    const isCritical = isDecisionCriticalCategory(category);

    const severity = scoreExceptionSeverity({
      kind,
      category,
      isDecisionCriticalCategory: isCritical,
      isPostMemo: input.isPostMemo,
      hasWeakRationale: false,
    });

    const impact = scoreDecisionImpact({ kind, severity, category, status: "open" });
    const narrative = buildExceptionNarrative({ kind, category, severity, factKey: gap.factKey, periodKey: null, status: "open" });

    exceptions.push({
      id: `gap-${gap.id}`,
      dealId: input.dealId,
      kind,
      category,
      severity,
      decisionImpact: impact,
      status: "open",
      source: "gap_queue",
      factKey: gap.factKey,
      periodKey: null,
      ...narrative,
      evidence: { gapType: gap.gapType, validationState: null },
    });
  }

  // 2. Resolutions → override/manual/deferred exceptions
  for (const res of input.resolutions) {
    const kind = ACTION_TO_KIND[res.action];
    if (!kind) continue;

    const category = categorizeFactKey(res.factKey);
    const isCritical = isDecisionCriticalCategory(category);
    const hasWeakRationale = !res.rationale || res.rationale.length < 10;

    const severity = scoreExceptionSeverity({
      kind,
      category,
      isDecisionCriticalCategory: isCritical,
      isPostMemo: input.isPostMemo,
      hasWeakRationale,
    });

    const impact = scoreDecisionImpact({ kind, severity, category, status: "resolved" });
    const narrative = buildExceptionNarrative({
      kind, category, severity,
      factKey: res.factKey, periodKey: null,
      status: "resolved",
      bankerAction: res.action,
      priorValue: res.priorValue,
      resolvedValue: res.resolvedValue,
    });

    exceptions.push({
      id: `res-${res.id}`,
      dealId: input.dealId,
      kind,
      category,
      severity,
      decisionImpact: impact,
      status: kind === "deferred_follow_up" ? "deferred" : "resolved",
      source: "resolution_audit",
      factKey: res.factKey,
      periodKey: null,
      ...narrative,
      evidence: {
        bankerAction: res.action,
        bankerRationale: res.rationale,
        priorValue: res.priorValue,
        resolvedValue: res.resolvedValue,
      },
    });
  }

  // 3. Stale snapshot
  if (input.snapshotStale) {
    const kind: ExceptionKind = "stale_snapshot";
    const category = categorizeFactKey(null);
    const severity = scoreExceptionSeverity({ kind, category, isDecisionCriticalCategory: false, isPostMemo: input.isPostMemo, hasWeakRationale: false });
    const impact = scoreDecisionImpact({ kind, severity, category, status: "open" });
    const narrative = buildExceptionNarrative({ kind, category, severity, factKey: null, periodKey: null, status: "open" });

    exceptions.push({
      id: `stale-snapshot`,
      dealId: input.dealId,
      kind, category, severity, decisionImpact: impact,
      status: "open",
      source: "snapshot_gate",
      factKey: null, periodKey: null,
      ...narrative,
      evidence: { blockerCode: "financial_snapshot_stale" },
    });
  }

  // 4. Material post-memo changes
  for (const factKey of input.materialChangesAfterMemo) {
    const kind: ExceptionKind = "material_change_after_memo";
    const category = categorizeFactKey(factKey);
    const isCritical = isDecisionCriticalCategory(category);
    const severity = scoreExceptionSeverity({ kind, category, isDecisionCriticalCategory: isCritical, isPostMemo: true, hasWeakRationale: false });
    const impact = scoreDecisionImpact({ kind, severity, category, status: "open" });
    const narrative = buildExceptionNarrative({ kind, category, severity, factKey, periodKey: null, status: "open" });

    exceptions.push({
      id: `post-memo-${factKey}`,
      dealId: input.dealId,
      kind, category, severity, decisionImpact: impact,
      status: "open",
      source: "memo_staleness",
      factKey, periodKey: null,
      ...narrative,
      evidence: {},
    });
  }

  // Sort: critical first, then high, moderate, low, info
  const ORDER: Record<string, number> = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  exceptions.sort((a, b) => (ORDER[a.severity] ?? 5) - (ORDER[b.severity] ?? 5));

  return exceptions;
}
