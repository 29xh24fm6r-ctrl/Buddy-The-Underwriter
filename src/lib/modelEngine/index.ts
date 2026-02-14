/**
 * Model Engine — Public API
 *
 * V2 authoritative financial modeling engine (Phase 11).
 * V1 rendering is decommissioned from user-facing paths.
 * Mode selector available via direct import from modeSelector.ts for ops.
 *
 * See engineAuthority.ts for the authoritative computation boundary.
 */

export { buildFinancialModel } from "./buildFinancialModel";
export type { FactInput } from "./buildFinancialModel";
export { extractBaseValues } from "./extractBaseValues";
export {
  topologicalSort,
  evaluateFormula,
  evaluateMetricGraph,
  evaluateMetricGraphWithAudit,
  evaluateFormulaWithDiagnostics,
  evaluateMetricGraphWithDiagnostics,
} from "./metricGraph";
export type { DiagnosticEntry, FormulaResult, GraphEvalResult, AuditGraphResult } from "./metricGraph";
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
// Authoritative engine boundary (Phase 10)
// ---------------------------------------------------------------------------
// NOTE: computeAuthoritativeEngine and computeLegacyComparison are NOT
// re-exported here because engineAuthority.ts has `import "server-only"`.
// Routes should import directly from "@/lib/modelEngine/engineAuthority".
// Type-only re-exports are safe (erased at compile time).

export type {
  AuthoritativeResult,
  LegacyResult,
} from "./engineAuthority";

// ---------------------------------------------------------------------------
// Mode selector types (value exports removed — import from modeSelector.ts)
// ---------------------------------------------------------------------------

export type {
  ModelEngineMode,
  ModeSelectionContext,
  ModeSelectionResult,
} from "./modeSelector";
