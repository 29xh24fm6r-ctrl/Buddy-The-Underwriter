/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 0 shadow-mode entry point.
 * Re-exports the read-only reconciliation harness (§7).
 */
export {
  compareProducers,
  type ShadowValue,
  type GoldenSetEntry,
  type Divergence,
  type DivergenceClass,
  type ShadowReport,
} from "@/lib/finengine/shadow/reconcile";
