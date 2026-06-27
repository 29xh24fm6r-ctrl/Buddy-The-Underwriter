/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 0 (§7 Shadow-mode protocol)
 *
 * Shadow reconciliation harness — SCAFFOLD ONLY (Phase 0).
 *
 * From Phase 2 on, the new canonical core computes every affected metric
 * ALONGSIDE the legacy engine. New results write to a shadow namespace
 * (`provenance.engine = 'finengine.core.shadow'`), NEVER to the live canonical
 * slot. This harness diffs the two producers per (deal, factKey, owner, period)
 * and classifies each divergence so no borrower-facing number silently changes:
 *
 *   - ZERO       new == legacy (within tolerance)            → allowed
 *   - INTENDED   matches a pre-registered golden-set fix     → allowed
 *   - UNEXPECTED anything else                               → BLOCKS cutover
 *
 * Phase 0 ships the pure diff + classification engine and the report shape. The
 * parallel-compute wiring and the golden-set registry are filled in from Phase 2
 * onward; until then `compareProducers` runs on supplied fixtures only.
 */

export type ShadowValue = {
  dealId: string;
  factKey: string;
  ownerType: string;
  fiscalPeriodEnd: string;
  value: number | null;
};

/**
 * A pre-registered intended divergence (golden-set entry). Phase 2+ populates
 * this with the known bug-fixes (OmniCare C-corp DSCR, multi-OPCO double-count,
 * DSCR denominator, Stress C). Phase 0 ships the empty registry + matcher.
 */
export type GoldenSetEntry = {
  dealId: string;
  factKey: string;
  ownerType?: string;
  fiscalPeriodEnd?: string;
  /** Expected post-fix value the new core should produce. */
  expectedNewValue: number | null;
  rationale: string;
  spec: string;
};

export type DivergenceClass = "ZERO" | "INTENDED" | "UNEXPECTED";

export type Divergence = {
  dealId: string;
  factKey: string;
  ownerType: string;
  fiscalPeriodEnd: string;
  legacyValue: number | null;
  newValue: number | null;
  absDelta: number | null;
  classification: DivergenceClass;
  note?: string;
};

export type ShadowReport = {
  total: number;
  zero: number;
  intended: number;
  unexpected: number;
  /** Cutover is blocked while any UNEXPECTED divergence remains. */
  cutoverBlocked: boolean;
  divergences: Divergence[];
};

/** Relative tolerance below which two values are treated as equal (ZERO). */
const REL_TOLERANCE = 1e-6;

function valuesEqual(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom <= REL_TOLERANCE;
}

function matchGolden(v: ShadowValue, golden: GoldenSetEntry[]): GoldenSetEntry | null {
  return (
    golden.find(
      (g) =>
        g.dealId === v.dealId &&
        g.factKey === v.factKey &&
        (g.ownerType == null || g.ownerType === v.ownerType) &&
        (g.fiscalPeriodEnd == null || g.fiscalPeriodEnd === v.fiscalPeriodEnd),
    ) ?? null
  );
}

/**
 * PURE. Diff legacy vs new (shadow) producers and classify every divergence.
 * Read-only — emits a report; performs no cutover and writes nothing.
 */
export function compareProducers(
  legacy: ShadowValue[],
  shadow: ShadowValue[],
  goldenSet: GoldenSetEntry[] = [],
): ShadowReport {
  const key = (v: { dealId: string; factKey: string; ownerType: string; fiscalPeriodEnd: string }) =>
    [v.dealId, v.factKey, v.ownerType, v.fiscalPeriodEnd].join("|");

  const legacyByKey = new Map(legacy.map((v) => [key(v), v]));
  const shadowByKey = new Map(shadow.map((v) => [key(v), v]));
  const allKeys = new Set([...legacyByKey.keys(), ...shadowByKey.keys()]);

  const divergences: Divergence[] = [];
  for (const k of allKeys) {
    const l = legacyByKey.get(k);
    const s = shadowByKey.get(k);
    const ref = (l ?? s)!;
    const legacyValue = l?.value ?? null;
    const newValue = s?.value ?? null;

    let classification: DivergenceClass;
    let note: string | undefined;
    if (valuesEqual(legacyValue, newValue)) {
      classification = "ZERO";
    } else {
      const g = matchGolden(ref, goldenSet);
      if (g && valuesEqual(newValue, g.expectedNewValue)) {
        classification = "INTENDED";
        note = `${g.spec}: ${g.rationale}`;
      } else {
        classification = "UNEXPECTED";
        note = g ? "golden-set entry exists but new value does not match expected" : "no golden-set entry";
      }
    }

    divergences.push({
      dealId: ref.dealId,
      factKey: ref.factKey,
      ownerType: ref.ownerType,
      fiscalPeriodEnd: ref.fiscalPeriodEnd,
      legacyValue,
      newValue,
      absDelta: legacyValue != null && newValue != null ? Math.abs(legacyValue - newValue) : null,
      classification,
      note,
    });
  }

  const zero = divergences.filter((d) => d.classification === "ZERO").length;
  const intended = divergences.filter((d) => d.classification === "INTENDED").length;
  const unexpected = divergences.filter((d) => d.classification === "UNEXPECTED").length;

  return {
    total: divergences.length,
    zero,
    intended,
    unexpected,
    cutoverBlocked: unexpected > 0,
    divergences,
  };
}
