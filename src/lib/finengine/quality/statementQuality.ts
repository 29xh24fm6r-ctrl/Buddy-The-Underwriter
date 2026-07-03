/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 3: Financial Statement Quality Engine.
 *
 * Determines how much trust to place in a financial statement, expressed as a
 * quality score plus the classified basis/assurance that produced it. Pure and
 * deterministic — no IO, no Date.now() (the caller supplies `asOfDate` for
 * staleness so results are reproducible).
 *
 * Layers ON TOP of the existing source-quality ranking in `provenance.ts`
 * (`inferSourceQualityRank`, 1=best … 7=weak) rather than re-deriving source
 * trust — that ranking stays the one authority for source ordering.
 *
 * Shadow-only: nothing here writes facts or changes a rendered number. Quality
 * conditions CONFIDENCE, never the value itself.
 */

import {
  inferSourceQualityRank,
  type SourceQualityRank,
} from "@/lib/finengine/provenance";

export type StatementBasis =
  | "ACCRUAL"
  | "CASH"
  | "MODIFIED_CASH"
  | "TAX_BASIS"
  | "UNKNOWN";

export type StatementAssurance =
  | "AUDITED"
  | "REVIEWED"
  | "COMPILED"
  | "CPA_PREPARED"
  | "TAX_RETURN"
  | "INTERNALLY_PREPARED"
  | "BORROWER_PREPARED"
  | "UNKNOWN";

export type StatementQualityInput = {
  sourceCanonicalType?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  engine?: string;
  confidence?: number | null;
  /** Period end the statement covers, ISO 'YYYY-MM-DD'. */
  periodEnd?: string | null;
  /** Reference "today" for staleness, ISO 'YYYY-MM-DD'. Omit → staleness not evaluated. */
  asOfDate?: string | null;
  /** True when the statement covers a full 12-month cycle. */
  coversFullYear?: boolean;
  /** Free-text hints from the doc (e.g. "prepared on the cash basis"). */
  narrativeHints?: string[];
  /** Explicit basis if already captured upstream (ACCOUNTING_BASIS). */
  declaredBasis?: StatementBasis | null;
};

export type QualityModifiers = {
  assurance: number;
  basis: number;
  staleness: number;
  partialYear: number;
};

export type StatementQuality = {
  basis: StatementBasis;
  assurance: StatementAssurance;
  sourceReliabilityRank: SourceQualityRank;
  /** Rank 1..7 mapped to [0,1] (1→1.0, 7→~0.14). */
  reliabilityScore: number;
  isStale: boolean;
  /** Whether staleness was actually evaluable (needs periodEnd + asOfDate). */
  stalenessEvaluated: boolean;
  isPartialYear: boolean;
  modifiers: QualityModifiers;
  /** Composite trust [0,1] — reliability × all modifiers, clamped. */
  qualityScore: number;
  /** Human/audit string, e.g. "REVIEWED / ACCRUAL". */
  provenanceBasis: string;
  concerns: string[];
};

/** Months of allowable age before a statement is considered stale. */
export const STALE_THRESHOLD_MONTHS = 18;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function hasAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

// ── Basis classifier ──────────────────────────────────────────────────────────

export function classifyStatementBasis(input: StatementQualityInput): StatementBasis {
  if (input.declaredBasis && input.declaredBasis !== "UNKNOWN") return input.declaredBasis;
  const hints = (input.narrativeHints ?? []).join(" ").toLowerCase();
  const ct = (input.sourceCanonicalType ?? "").toUpperCase();

  // Order matters: "modified cash" before "cash", specific before generic.
  if (hasAny(hints, ["modified cash", "modified-cash"])) return "MODIFIED_CASH";
  if (hasAny(hints, ["accrual basis", "accrual"])) return "ACCRUAL";
  if (hasAny(hints, ["cash basis", "cash-basis"])) return "CASH";
  if (hasAny(hints, ["tax basis", "income tax basis"])) return "TAX_BASIS";
  if (ct.includes("TAX_RETURN") || /\b(1120S?|1065|1040)\b/.test(ct)) return "TAX_BASIS";
  // Audited/reviewed/compiled statements are GAAP accrual absent contra hints.
  if (hasAny(ct, ["AUDITED", "REVIEWED", "COMPILED"])) return "ACCRUAL";
  return "UNKNOWN";
}

// ── Assurance classifier ──────────────────────────────────────────────────────

export function classifyStatementAssurance(input: StatementQualityInput): StatementAssurance {
  const ct = (input.sourceCanonicalType ?? "").toUpperCase();
  const ref = (input.sourceRef ?? "").toLowerCase();
  const hints = (input.narrativeHints ?? []).join(" ").toLowerCase();

  if (ct.includes("AUDITED") || hasAny(hints, ["independent auditor", "audit opinion", "audited"])) return "AUDITED";
  if (ct.includes("REVIEWED") || hasAny(hints, ["review engagement", "reviewed"])) return "REVIEWED";
  if (ct.includes("COMPILED") || hasAny(hints, ["compilation", "compiled"])) return "COMPILED";
  if (ct.includes("TAX_RETURN") || /\b(1120S?|1065|1040)\b/.test(ct) || ref.startsWith("tax_return:")) return "TAX_RETURN";
  if (hasAny(hints, ["prepared by cpa", "cpa-prepared", "cpa prepared"])) return "CPA_PREPARED";
  if (
    ct.includes("PERSONAL_FINANCIAL_STATEMENT") ||
    ct.includes("PFS") ||
    ct.includes("SIGNED") ||
    hasAny(hints, ["borrower prepared", "management prepared", "borrower-prepared"])
  )
    return "BORROWER_PREPARED";
  if (ct.includes("FINANCIAL_STATEMENT") || ct.includes("INTERNAL")) return "INTERNALLY_PREPARED";
  return "UNKNOWN";
}

// ── Modifiers ─────────────────────────────────────────────────────────────────

const ASSURANCE_MODIFIER: Record<StatementAssurance, number> = {
  AUDITED: 1.0,
  REVIEWED: 0.9,
  TAX_RETURN: 0.88,
  CPA_PREPARED: 0.82,
  COMPILED: 0.78,
  INTERNALLY_PREPARED: 0.6,
  BORROWER_PREPARED: 0.55,
  UNKNOWN: 0.5,
};

const BASIS_MODIFIER: Record<StatementBasis, number> = {
  ACCRUAL: 1.0,
  MODIFIED_CASH: 0.9,
  TAX_BASIS: 0.88,
  CASH: 0.8,
  UNKNOWN: 0.85,
};

/** Whole months between two ISO dates (a before b). Returns null if unparseable. */
function monthsBetween(a: string, b: string): number | null {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  if (!ay || !am || !by || !bm) return null;
  let months = (by - ay) * 12 + (bm - am);
  if ((bd || 0) < (ad || 0)) months -= 1;
  return months;
}

export function reliabilityScoreFromRank(rank: SourceQualityRank): number {
  // 1 → 1.0, 7 → ~0.14 (linear, (8-rank)/7).
  return clamp01((8 - rank) / 7);
}

// ── Main assessment ───────────────────────────────────────────────────────────

export function assessStatementQuality(input: StatementQualityInput): StatementQuality {
  const basis = classifyStatementBasis(input);
  const assurance = classifyStatementAssurance(input);
  const sourceReliabilityRank = inferSourceQualityRank({
    sourceType: input.sourceType,
    sourceCanonicalType: input.sourceCanonicalType,
    sourceRef: input.sourceRef,
    engine: input.engine,
    confidence: input.confidence,
  });
  const reliabilityScore = reliabilityScoreFromRank(sourceReliabilityRank);

  const concerns: string[] = [];

  // Staleness (only if both dates available).
  let isStale = false;
  let stalenessEvaluated = false;
  if (input.periodEnd && input.asOfDate) {
    const age = monthsBetween(input.periodEnd, input.asOfDate);
    if (age != null) {
      stalenessEvaluated = true;
      isStale = age > STALE_THRESHOLD_MONTHS;
      if (isStale) concerns.push(`stale_statement:${age}mo_old`);
    }
  } else {
    concerns.push("staleness_not_evaluated");
  }

  const isPartialYear = input.coversFullYear === false;
  if (isPartialYear) concerns.push("partial_year_statement");

  if (assurance === "UNKNOWN") concerns.push("unknown_assurance_level");
  if (basis === "UNKNOWN") concerns.push("unknown_accounting_basis");
  if (assurance === "BORROWER_PREPARED" || assurance === "INTERNALLY_PREPARED") {
    concerns.push("unaudited_management_prepared");
  }

  const modifiers: QualityModifiers = {
    assurance: ASSURANCE_MODIFIER[assurance],
    basis: BASIS_MODIFIER[basis],
    staleness: isStale ? 0.85 : 1.0,
    partialYear: isPartialYear ? 0.8 : 1.0,
  };

  const qualityScore = clamp01(
    reliabilityScore * modifiers.assurance * modifiers.basis * modifiers.staleness * modifiers.partialYear,
  );

  return {
    basis,
    assurance,
    sourceReliabilityRank,
    reliabilityScore,
    isStale,
    stalenessEvaluated,
    isPartialYear,
    modifiers,
    qualityScore,
    provenanceBasis: `${assurance} / ${basis}`,
    concerns,
  };
}

/**
 * Apply a statement's quality modifier to a raw metric value's confidence (NOT
 * the value itself — quality never silently changes a number). Returns a
 * quality-adjusted confidence in [0,1] a downstream consumer can gate on.
 */
export function qualityAdjustedConfidence(baseConfidence: number, q: StatementQuality): number {
  return clamp01(baseConfidence * q.qualityScore);
}
