/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 2: method-strategy registry +
 * cross-method reconciliation. Shadow-only — these strategies compute alongside
 * the legacy engines; nothing is cut over. Pure.
 */

import type {
  CashFlowMethod,
  CashFlowResult,
  SpreadInputs,
  ProductProfile,
  EntityNode,
  MethodId,
} from "@/lib/finengine/contracts";
import { adjustedEbitdaMethod } from "@/lib/finengine/methods/adjustedEbitda";
import { sdeMethod } from "@/lib/finengine/methods/sde";
import { traditionalMethod } from "@/lib/finengine/methods/traditional";
import { ucaMethod } from "@/lib/finengine/methods/uca";
import { creNoiMethod } from "@/lib/finengine/methods/creNoi";

export const ALL_METHODS: Record<MethodId, CashFlowMethod> = {
  ADJ_EBITDA: adjustedEbitdaMethod,
  SDE: sdeMethod,
  TRADITIONAL: traditionalMethod,
  UCA: ucaMethod,
  CRE_NOI: creNoiMethod,
  // GLOBAL is delivered in Phase 3 (entity graph).
  GLOBAL: undefined as unknown as CashFlowMethod,
};

export {
  adjustedEbitdaMethod,
  sdeMethod,
  traditionalMethod,
  ucaMethod,
  creNoiMethod,
};

/** Run every method eligible for the profile+entity over the same inputs. */
export function runApplicableMethods(
  profile: ProductProfile,
  entity: EntityNode,
  inputs: SpreadInputs,
): CashFlowResult[] {
  const out: CashFlowResult[] = [];
  for (const id of profile.eligibleMethods) {
    const m = ALL_METHODS[id];
    if (m && m.appliesTo(profile, entity)) out.push(m.compute(inputs, () => { throw new Error("policy not used by cash-flow methods"); }));
  }
  return out;
}

export type MethodReconciliation = {
  status: "unique" | "reconciled" | "conflict";
  /** Methods that produced a non-null value. */
  methods: Array<{ method: MethodId; value: number | null }>;
  min: number | null;
  max: number | null;
  /** Relative spread (max−min)/|max|; null when <2 comparable values. */
  relativeSpread: number | null;
  note: string;
};

/**
 * Reconcile ≥2 method outputs. When they diverge beyond tolerance this EMITS a
 * conflict SIGNAL (never a silent pick) — the §2 requirement. Default tolerance
 * 1% relative.
 */
export function reconcileMethods(results: CashFlowResult[], tolerance = 0.01): MethodReconciliation {
  const methods = results.map((r) => ({ method: r.method, value: r.cashFlowAvailable }));
  const vals = methods.map((m) => m.value).filter((v): v is number => v != null);
  if (vals.length < 2) {
    return { status: "unique", methods, min: vals[0] ?? null, max: vals[0] ?? null, relativeSpread: null, note: "Fewer than two comparable method outputs." };
  }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const denom = Math.max(Math.abs(max), Math.abs(min), 1);
  const relativeSpread = (max - min) / denom;
  const conflict = relativeSpread > tolerance;
  return {
    status: conflict ? "conflict" : "reconciled",
    methods,
    min,
    max,
    relativeSpread,
    note: conflict
      ? `Method outputs diverge by ${(relativeSpread * 100).toFixed(1)}% — conflict signal raised for analyst review (no silent pick).`
      : `Method outputs agree within ${(tolerance * 100).toFixed(0)}%.`,
  };
}
