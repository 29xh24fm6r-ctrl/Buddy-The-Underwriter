/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 1: Finengine Registry Consolidation.
 *
 * FORMULA ALIAS NORMALIZATION. Rendering surfaces (STANDARD spread, classic
 * spread, GCF, debt-service, collateral) refer to formulas by their own local
 * ids. This module is the one place those local ids are normalized to a single
 * canonical METRIC_REGISTRY id — so a shadow adapter (PR 2) or a reconciliation
 * matrix (PR 18) can line legacy output up against finengine output by canonical
 * id instead of guessing at name collisions.
 *
 * The STANDARD-spread aliases are DERIVED from `STANDARD_FORMULAS` (the live
 * source), not re-typed here — so this map cannot silently drift from what the
 * spread actually renders. Cross-surface aliases that have no single source of
 * truth are curated in `SUPPLEMENTAL_ALIASES` with an explicit provenance note.
 *
 * Pure + standalone.
 */

import { STANDARD_FORMULAS } from "@/lib/financialSpreads/standard/formulas/registry";
import { CANONICAL_METRIC_IDS } from "@/lib/finengine/registry/metricRegistry";

/** How an alias relates to the canonical metric registry. */
export type FormulaAliasKind =
  /** Delegates to a canonical METRIC_REGISTRY formula. */
  | "canonical"
  /** Renderer-owned structural aggregation (subtotal / balance check) — no single metric. */
  | "structural"
  /** Identity pass-through of a raw fact key (no computation). */
  | "passthrough";

export type FormulaAliasResolution = {
  alias: string;
  /** Canonical METRIC_REGISTRY id, or null for structural / passthrough aliases. */
  canonicalMetricId: string | null;
  kind: FormulaAliasKind;
  /** Where the alias comes from (for audit provenance). */
  source: string;
};

/** Is `expr` a bare identity of a single fact key (e.g. "TOTAL_REVENUE")? */
function isIdentityExpr(expr: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(expr.trim());
}

function buildStandardAliasMap(): Record<string, FormulaAliasResolution> {
  const map: Record<string, FormulaAliasResolution> = {};
  for (const [alias, formula] of Object.entries(STANDARD_FORMULAS)) {
    if (formula.metricRegistryId) {
      map[alias] = {
        alias,
        canonicalMetricId: formula.metricRegistryId,
        kind: "canonical",
        source: "STANDARD_FORMULAS",
      };
    } else if (isIdentityExpr(formula.expr)) {
      map[alias] = {
        alias,
        canonicalMetricId: null,
        kind: "passthrough",
        source: "STANDARD_FORMULAS",
      };
    } else {
      map[alias] = {
        alias,
        canonicalMetricId: null,
        kind: "structural",
        source: "STANDARD_FORMULAS",
      };
    }
  }
  return map;
}

/**
 * Cross-surface aliases with no single generating source. Each MUST resolve to a
 * real canonical metric id (guarded by the registry audit). Add here only when a
 * rendering surface uses a name that differs from its canonical metric id.
 */
export const SUPPLEMENTAL_ALIASES: Record<string, string> = {
  // GCF: legacy rendered/debt-service surfaces used the bare name before the
  // canonical GCF_* namespace landed. Both point at the one canonical GCF metric.
  GLOBAL_CASH_FLOW: "GCF_GLOBAL_CASH_FLOW",
  // Debt-service DSCR family: the classic spread labels the global DSCR "GCF DSCR".
  GLOBAL_DSCR: "GCF_DSCR",
  // Collateral coverage: rendered collateral panels label it "coverage ratio".
  COLLATERAL_COVERAGE_RATIO: "COLLATERAL_COVERAGE",
};

const STANDARD_ALIAS_MAP = buildStandardAliasMap();

/** The full alias → resolution map (STANDARD spread ∪ supplemental cross-surface). */
export const FORMULA_ALIAS_MAP: Record<string, FormulaAliasResolution> = (() => {
  const merged: Record<string, FormulaAliasResolution> = { ...STANDARD_ALIAS_MAP };
  for (const [alias, canonicalMetricId] of Object.entries(SUPPLEMENTAL_ALIASES)) {
    // Do not clobber a STANDARD-derived alias with a supplemental one.
    if (!merged[alias]) {
      merged[alias] = {
        alias,
        canonicalMetricId,
        kind: "canonical",
        source: "SUPPLEMENTAL_ALIASES",
      };
    }
  }
  return merged;
})();

/** Full resolution for an alias (or null if the alias is unknown). Never throws. */
export function resolveFormulaAlias(alias: string): FormulaAliasResolution | null {
  return FORMULA_ALIAS_MAP[alias] ?? null;
}

/**
 * Normalize a rendering-surface alias to its canonical METRIC_REGISTRY id.
 * Returns null when the alias is unknown OR is structural/passthrough (i.e. has
 * no single canonical metric). Callers that need to distinguish those cases use
 * {@link resolveFormulaAlias}.
 */
export function normalizeFormulaAlias(alias: string): string | null {
  // A caller may pass an already-canonical id — treat that as a no-op.
  if (CANONICAL_METRIC_IDS.has(alias)) return alias;
  const res = FORMULA_ALIAS_MAP[alias];
  return res?.canonicalMetricId ?? null;
}

/** All aliases that resolve to a canonical metric (excludes structural/passthrough). */
export function canonicalAliases(): FormulaAliasResolution[] {
  return Object.values(FORMULA_ALIAS_MAP).filter((r) => r.kind === "canonical");
}
