/**
 * Model Engine V2 — Public API
 *
 * Feature-flagged parallel financial modeling engine.
 * Mode selector: selectModelEngineMode() → v1 | v2_shadow | v2_primary.
 *
 * Phase 10: V2 can be promoted to primary via env vars or allowlists.
 * See modeSelector.ts for mode determination logic.
 */

export { buildFinancialModel } from "./buildFinancialModel";
export type { FactInput } from "./buildFinancialModel";
export {
  topologicalSort,
  evaluateFormula,
  evaluateMetricGraph,
  evaluateFormulaWithDiagnostics,
  evaluateMetricGraphWithDiagnostics,
} from "./metricGraph";
export type { DiagnosticEntry, FormulaResult, GraphEvalResult } from "./metricGraph";
export { loadMetricRegistry, getV1SeedDefinitions } from "./metricRegistryLoader";
export { computeCapitalModel } from "./capitalModel";
export { evaluateRisk } from "./riskEngine";
export { deterministicHash } from "./hashing";
export {
  canonicalSerialize,
  canonicalHash,
  hashFinancialModel,
  NONDETERMINISTIC_FIELD_NAMES,
} from "./hash/canonicalSerialize";
export { saveModelSnapshot, loadLatestSnapshot } from "./snapshotService";
export type {
  FinancialModel,
  FinancialPeriod,
  MetricDefinition,
  FormulaNode,
  LoanAssumptions,
  CapitalModelResult,
  RiskFlag,
  RiskResult,
  ModelSnapshot,
  ModelPreviewResult,
} from "./types";

// ---------------------------------------------------------------------------
// Mode selector (Phase 10)
// ---------------------------------------------------------------------------

export {
  selectModelEngineMode,
  isV2Enabled,
  isV2Primary,
  isV1RendererDisabled,
} from "./modeSelector";
export type {
  ModelEngineMode,
  ModeSelectionContext,
  ModeSelectionResult,
} from "./modeSelector";

// ---------------------------------------------------------------------------
// Feature flag (backward compat — delegates to mode selector)
// ---------------------------------------------------------------------------

import { isV2Enabled as _isV2Enabled } from "./modeSelector";

/**
 * @deprecated Use selectModelEngineMode() for context-aware mode selection.
 * This function is retained for backward compatibility with existing call sites.
 */
export function isModelEngineV2Enabled(): boolean {
  const enabled = _isV2Enabled();
  if (enabled && !(globalThis as any).__v2_logged) {
    (globalThis as any).__v2_logged = true;
    console.log("[ModelEngine] V2 enabled — shadow mode active");
  }
  return enabled;
}
