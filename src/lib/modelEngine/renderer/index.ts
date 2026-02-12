/**
 * Model Engine V2 — Renderer Migration (public API)
 *
 * PHASE 3 SCOPE: Shadow comparison only.
 * Do NOT wire into production rendering paths until Phase 3 Part 2.
 */

// Contract types
export type {
  SpreadViewColumn,
  SpreadViewRow,
  SpreadViewSection,
  SpreadViewModel,
  SpreadRowKind,
} from "./types";

// Adapters
export { renderFromFinancialModel } from "./v2Adapter";
export { renderFromLegacySpread } from "./v1Adapter";

// Diff utility
export { diffSpreadViewModels } from "./viewModelDiff";
export type {
  CellDiff,
  SectionDiff,
  ViewModelDiffResult,
} from "./viewModelDiff";

// Formula evaluation (shared)
export {
  evaluateMoodysFormula,
  evaluateStructuralExpr,
  formatMoodysValue,
} from "./formulaEval";
