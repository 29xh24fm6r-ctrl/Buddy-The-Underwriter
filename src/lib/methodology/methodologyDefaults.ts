/**
 * SPEC-B4 — Default Methodology Slate.
 *
 * The default slate is what Buddy uses when no banker choices exist.
 * Axes 1 and 3 default to "standard" (matches current code behavior).
 * Axes 2, 4, 5 default to more conservative variants (intentional shift).
 */

import type { MethodologySlate } from "./types";

export const DEFAULT_METHODOLOGY_SLATE: MethodologySlate = {
  ncads_source: "standard",              // Axis 1: matches current behavior
  ebitda_addback_stack: "conservative",   // Axis 2: intentional conservative shift
  officer_comp: "standard",              // Axis 3: matches current behavior
  affiliate_ownership: "conservative",   // Axis 4: intentional conservative shift
  living_expense: "sba_sop_minimum",     // Axis 5: intentional conservative shift
};
