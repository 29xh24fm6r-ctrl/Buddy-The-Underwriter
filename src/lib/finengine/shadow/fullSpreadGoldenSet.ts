/**
 * SPEC-FINENGINE-FULL-SPREAD-GOLDEN-1 — golden-set registry for the full-spread
 * shadow harness (Phase 2 of the god-tier one-engine cutover).
 *
 * Registers the known INTENDED divergence(s) so `runFullSpreadShadow` classifies
 * the finengine's deliberate fixes as INTENDED rather than UNEXPECTED — for the
 * metrics this harness actually GATES (`OVERLAPPING_METRICS`). For Phase 2 that is
 * EBITDA only: the C-corp base fix where the finengine correctly computes EBITDA
 * from pre-tax base income while legacy persisted the C-corp-gated bug (OmniCare
 * `-457567`, `LEGACY_OMNICARE_EBITDA_BUG`).
 *
 * NG2 — THE CORE RULE: the expected value is the INDEPENDENT golden
 * (`goldenConservativeEbitda`, a separate derivation from the tax facts), NEVER
 * read back from `computeDealSpread`/the engine. Reading it from the engine would
 * make INTENDED a tautology and defeat the gate. This module therefore imports the
 * independent derivation and the adapter ONLY — it must never import the engine
 * spread (enforced by the import-grep guard in the tests).
 *
 * Out of scope (§0.3): DSCR denominator, multi-OPCO NCADS double-count, and Stress
 * C revenue compression are REAL finengine fixes but live in the decision-core,
 * not in any `computeDealSpread` cell — this harness never gates them, so no golden
 * is authored for them here.
 *
 * Pure — no DB, no engine-spread import. Read-only (NG1).
 */

import {
  buildCertifiedSnapshots,
  type CertifiedFactRow,
} from "@/lib/finengine/shadow/dealInputAdapter";
import { goldenConservativeEbitda } from "@/lib/finengine/shadow/ebitdaGoldenSet";
import type { GoldenSetEntry } from "@/lib/finengine/shadow/reconcile";

const SPEC = "SPEC-FINENGINE-FULL-SPREAD-GOLDEN-1";

/**
 * Registered intended divergences for the full-spread harness's GATED metrics.
 * Scope: EBITDA only (the sole OVERLAPPING metric). One entry per (entity scope,
 * period). The expected value is the INDEPENDENT golden (NG2) — never the engine.
 *
 * An unresolved base (`conservativeEbitda == null`) registers nothing, so a
 * genuinely-unresolved EBITDA correctly stays UNEXPECTED rather than being papered
 * over.
 */
export function fullSpreadGoldenSet(dealId: string, rows: CertifiedFactRow[]): GoldenSetEntry[] {
  const snaps = buildCertifiedSnapshots(dealId, rows);
  const out: GoldenSetEntry[] = [];
  for (const snap of snaps) {
    const g = goldenConservativeEbitda(snap.facts);
    if (g.conservativeEbitda == null) continue; // unresolved base ⇒ no registration (stays UNEXPECTED)
    out.push({
      dealId,
      factKey: "EBITDA",
      ownerType: snap.entityScope, // keys identically to the shadow side (Phase 1 R3)
      fiscalPeriodEnd: snap.fiscalPeriodEnd,
      expectedNewValue: g.conservativeEbitda, // INDEPENDENT derivation (NG2)
      rationale:
        `C-corp/pass-through base ${g.baseKey}(${g.base ?? "—"}) + interest(${g.interest}) + ` +
        `dep(${g.depreciation}) + amort(${g.amortization}); pre-tax base, taxes NOT added back. ` +
        `Legacy persisted the C-corp-gated bug.`,
      spec: SPEC,
    });
  }
  return out;
}
