/**
 * SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream F: sizing→pricing gate.
 *
 * Promotes the read-only sizingPricingShadow into a flag-gated gate. The pricing
 * path reconciles the priced facility against the engine-sized maximum
 * (reconcileSizingVsPricing → ZERO / INTENDED / UNEXPECTED) and then asks THIS
 * module whether to gate:
 *
 *   - mode "shadow"  (flag OFF, the default for every tenant): log the
 *     classification and change NOTHING. Today's borrower-facing behaviour is
 *     preserved byte-for-byte (NG1).
 *   - mode "enforce" (flag ON, nobody yet): an UNEXPECTED over-sized facility is
 *     GATED (blocks finalize / requires a registered exception). ZERO and
 *     INTENDED pass.
 *
 * Any product SizingResult plugs in — CRE/ABL (sizeCre/sizeBorrowingBase) and the
 * new product sizings (sizeEquipment/sizeConstruction/sizeCAndI/sizeRevolver) all
 * share the SizingResult shape the reconciler consumes, so the gate covers them
 * all. Pure — no DB, no price mutation; the caller acts on `gated`.
 */

import { isSizingGateOn, type SizingGateFlags } from "@/lib/finengine/featureFlags";
import { reconcileSizingVsPricing, type SizingPricingShadow } from "@/lib/finengine/sizing/sizingPricingShadow";
import type { SizingResult } from "@/lib/finengine/sizing";

export type SizingGateMode = "shadow" | "enforce";

export type SizingGateDecision = {
  mode: SizingGateMode;
  /** True only in enforce mode on an UNEXPECTED (un-excused over-size). Always false in shadow mode. */
  gated: boolean;
  classification: SizingPricingShadow["classification"];
  shadow: SizingPricingShadow;
  note: string;
};

/**
 * Resolve the per-tenant sizing-gate flags from env (a comma-separated bank-id
 * allowlist in SIZING_GATE_TENANTS). Absent ⇒ {} ⇒ every tenant OFF (shadow).
 * Flipping a tenant ON = add its id to the env var; reverting = remove it.
 * Mirrors resolveMemoCutoverFlags.
 */
export function resolveSizingGateFlags(env: Record<string, string | undefined> = process.env): SizingGateFlags {
  const raw = env.SIZING_GATE_TENANTS;
  if (!raw) return {};
  const flags: SizingGateFlags = {};
  for (const id of raw.split(",").map((s) => s.trim()).filter(Boolean)) flags[id] = true;
  return flags;
}

/**
 * Evaluate the gate for an already-computed shadow. OFF (default) ⇒ shadow mode,
 * never gated. ON ⇒ enforce mode, gated when the shadow is UNEXPECTED. Pure.
 */
export function evaluateSizingGate(args: {
  tenantId: string | null | undefined;
  shadow: SizingPricingShadow;
  flags?: SizingGateFlags;
}): SizingGateDecision {
  const on = isSizingGateOn(args.tenantId, args.flags);
  const mode: SizingGateMode = on ? "enforce" : "shadow";
  const gated = on && args.shadow.classification === "UNEXPECTED";
  const note = !on
    ? `shadow only (gate OFF) — ${args.shadow.classification}; pricing unchanged. ${args.shadow.note}`
    : gated
      ? `GATED (gate ON) — over-sized facility blocked; register an exception or resize. ${args.shadow.note}`
      : `gate ON — ${args.shadow.classification} passes. ${args.shadow.note}`;
  return { mode, gated, classification: args.shadow.classification, shadow: args.shadow, note };
}

/**
 * Convenience: reconcile a priced amount against any product SizingResult and
 * evaluate the gate in one call. The single entry point the pricing path uses;
 * the product sizings (A–D) plug in here via their shared SizingResult shape.
 */
export function gateSizingVsPricing(args: {
  tenantId: string | null | undefined;
  pricedLoanAmount: number;
  sizing: SizingResult;
  tolerancePct?: number;
  intendedReason?: string;
  flags?: SizingGateFlags;
}): SizingGateDecision {
  const shadow = reconcileSizingVsPricing({
    pricedLoanAmount: args.pricedLoanAmount,
    sizing: args.sizing,
    tolerancePct: args.tolerancePct,
    intendedReason: args.intendedReason,
  });
  return evaluateSizingGate({ tenantId: args.tenantId, shadow, flags: args.flags });
}
