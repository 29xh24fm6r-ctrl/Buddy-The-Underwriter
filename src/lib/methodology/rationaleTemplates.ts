/**
 * SPEC-B4 — Per-axis, per-variant rationale string builders.
 *
 * Placeholder templates — refined in Batch 3 credit-voice review pass.
 * Pure functions — no side effects.
 */

import type { MethodologyAxisId, MethodologyVariantId } from "./types";
import { METHODOLOGY_AXES } from "./methodologyAxes";

/**
 * Build a rationale string for a given axis + variant choice.
 * Falls back to the variant's static rationale if no dynamic template exists.
 */
export function buildRationale(
  axis: MethodologyAxisId,
  variant: MethodologyVariantId,
): string {
  const axisConfig = METHODOLOGY_AXES[axis];
  if (!axisConfig) return `Unknown axis: ${axis}`;

  const variantConfig = axisConfig.variants.find((v) => v.id === variant);
  if (!variantConfig) return `Unknown variant ${variant} for axis ${axis}`;

  return variantConfig.rationale;
}

/**
 * Build a short label string for display in the classic spread PDF
 * methodology block.
 */
export function buildMethodologyLabel(
  axis: MethodologyAxisId,
  variant: MethodologyVariantId,
): string {
  const axisConfig = METHODOLOGY_AXES[axis];
  if (!axisConfig) return axis;

  const variantConfig = axisConfig.variants.find((v) => v.id === variant);
  if (!variantConfig) return `${axisConfig.label}: ${variant}`;

  return `${axisConfig.label}: ${variantConfig.label}`;
}
