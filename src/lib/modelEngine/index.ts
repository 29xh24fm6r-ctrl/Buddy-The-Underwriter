/**
 * Model Engine V2 — Public API
 *
 * Feature-flagged parallel financial modeling engine.
 * Default: disabled. Set USE_MODEL_ENGINE_V2=true to enable.
 *
 * PHASE 2 SCOPE: Parity validation utilities only.
 * Do NOT import into production rendering paths (spreads, extraction, lifecycle, pricing).
 * Parity tooling lives under ./parity/ — import from there for comparison work.
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
// Feature flag
// ---------------------------------------------------------------------------

export function isModelEngineV2Enabled(): boolean {
  const enabled = process.env.USE_MODEL_ENGINE_V2 === "true";
  if (enabled && !(globalThis as any).__v2_logged) {
    (globalThis as any).__v2_logged = true;
    console.log("[ModelEngine] V2 enabled — shadow mode active");
  }
  return enabled;
}
