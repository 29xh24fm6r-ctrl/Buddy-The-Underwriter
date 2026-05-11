/**
 * SPEC-B4 — Default Methodology Slate.
 *
 * The default slate is what Buddy uses when no banker choices exist.
 * Axes 1 and 3 default to "standard" (matches current code behavior).
 * Axes 2 and 4 default to more conservative variants (intentional shift).
 *
 * Axis 5 (living_expense) ships as "standard" in v1.0 because the SBA SOP
 * minimum implementation in computeGlobalCashFlow hardcodes the single-filer
 * floor ($24k/yr) regardless of household size. Shipping "sba_sop_minimum"
 * as default would inflate GCF for family-of-4 borrowers by ~$24k/yr while
 * claiming SBA SOP compliance in provenance — a half-implementation that
 * the methodology layer must not ship as the default behavior.
 *
 * v1.0.1 target: wire household_size from borrowers/PFS, branch the SBA
 * floor by household size, then flip default to "sba_sop_minimum".
 */

import type { MethodologySlate } from "./types";

export const DEFAULT_METHODOLOGY_SLATE: MethodologySlate = {
  ncads_source: "standard",              // Axis 1: matches current behavior
  ebitda_addback_stack: "conservative",   // Axis 2: intentional conservative shift
  officer_comp: "standard",              // Axis 3: matches current behavior
  affiliate_ownership: "conservative",   // Axis 4: intentional conservative shift
  living_expense: "standard",            // Axis 5: TEMP — see v1.0.1 target above
};
