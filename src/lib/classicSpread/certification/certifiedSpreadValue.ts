/**
 * SPEC-CLASSIC-SPREAD-CERTIFIED-NUMBER-SOURCES-1 (Phase 1)
 *
 * A displayed spread value is only allowed to render when it is *certified*: it carries
 * a source trace (a real accepted fact, or a named formula over certified inputs) or is
 * intentionally `unavailable`/`blocked`. No naked number may reach the PDF — the row
 * builders consume CertifiedSpreadValue, never a bare `number | null`.
 *
 * This module is the value vocabulary + constructors. It is pure (no DB, no IO) so the
 * whole certification chain is deterministically testable.
 */

export type CertifiedStatus =
  | "certified" // value is backed by a fact or a formula over certified inputs
  | "unavailable" // required certified input(s) missing — render blank, not zero
  | "blocked"; // certified inputs conflict (e.g. accounting identity violated) — must not render a number

export type CertifiedSourceType = "direct_fact" | "derived_formula" | "unavailable";

/**
 * Every number the spread wants to show is wrapped in one of these. The trace fields
 * answer "why is this number allowed to render and where did it come from".
 */
export type CertifiedSpreadValue = {
  value: number | null;
  status: CertifiedStatus;
  sourceType: CertifiedSourceType;
  sourceFactIds: string[];
  sourceFactKeys: string[];
  sourceDocumentIds: string[];
  sourceCanonicalTypes: string[];
  confidence: number | null;
  formulaName: string | null;
  caveats: string[];
  failureReason: string | null;
};

const uniq = (xs: (string | null | undefined)[]): string[] =>
  [...new Set(xs.filter((x): x is string => !!x))].sort();

/** Source trace of a single accepted fact (used to build a direct_fact value). */
export type FactTrace = {
  factId: string | null;
  factKey: string;
  documentId: string | null;
  canonicalType: string | null;
  confidence: number | null;
};

/** A value taken directly from one accepted, reconciled canonical fact. */
export function certifiedDirectFact(
  value: number | null,
  trace: FactTrace,
  caveats: string[] = [],
): CertifiedSpreadValue {
  return {
    value,
    status: "certified",
    sourceType: "direct_fact",
    sourceFactIds: uniq([trace.factId]),
    sourceFactKeys: uniq([trace.factKey]),
    sourceDocumentIds: uniq([trace.documentId]),
    sourceCanonicalTypes: uniq([trace.canonicalType]),
    confidence: trace.confidence,
    formulaName: null,
    caveats: [...caveats],
    failureReason: null,
  };
}

/**
 * A value computed by a named formula from certified inputs. The source trace is the
 * union of the inputs' traces so provenance survives derivation.
 */
export function certifiedDerived(
  value: number,
  formulaName: string,
  inputs: CertifiedSpreadValue[],
  caveats: string[] = [],
): CertifiedSpreadValue {
  const confidences = inputs.map((i) => i.confidence).filter((c): c is number => c !== null);
  return {
    value,
    status: "certified",
    sourceType: "derived_formula",
    sourceFactIds: uniq(inputs.flatMap((i) => i.sourceFactIds)),
    sourceFactKeys: uniq(inputs.flatMap((i) => i.sourceFactKeys)),
    sourceDocumentIds: uniq(inputs.flatMap((i) => i.sourceDocumentIds)),
    sourceCanonicalTypes: uniq(inputs.flatMap((i) => i.sourceCanonicalTypes)),
    // A derived value is only as confident as its weakest certified input.
    confidence: confidences.length > 0 ? Math.min(...confidences) : null,
    formulaName,
    caveats: uniq([...inputs.flatMap((i) => i.caveats), ...caveats]),
    failureReason: null,
  };
}

/** Intentionally blank — a required certified input is missing. Renders blank, never 0. */
export function certifiedUnavailable(
  failureReason: string,
  caveats: string[] = [],
): CertifiedSpreadValue {
  return {
    value: null,
    status: "unavailable",
    sourceType: "unavailable",
    sourceFactIds: [],
    sourceFactKeys: [],
    sourceDocumentIds: [],
    sourceCanonicalTypes: [],
    confidence: null,
    formulaName: null,
    caveats: [...caveats],
    failureReason,
  };
}

/**
 * Certified inputs exist but conflict (e.g. component liabilities contradict a derived
 * total). The number is economically false and must not render — carry the input trace
 * so the audit can explain the conflict.
 */
export function certifiedBlocked(
  failureReason: string,
  inputs: CertifiedSpreadValue[] = [],
  caveats: string[] = [],
): CertifiedSpreadValue {
  return {
    value: null,
    status: "blocked",
    sourceType: "derived_formula",
    sourceFactIds: uniq(inputs.flatMap((i) => i.sourceFactIds)),
    sourceFactKeys: uniq(inputs.flatMap((i) => i.sourceFactKeys)),
    sourceDocumentIds: uniq(inputs.flatMap((i) => i.sourceDocumentIds)),
    sourceCanonicalTypes: uniq(inputs.flatMap((i) => i.sourceCanonicalTypes)),
    confidence: null,
    formulaName: null,
    caveats: uniq([...inputs.flatMap((i) => i.caveats), ...caveats]),
    failureReason,
  };
}

/** True when a value is allowed to render a number. */
export function isRenderable(v: CertifiedSpreadValue): boolean {
  return v.status === "certified" && v.value !== null;
}
