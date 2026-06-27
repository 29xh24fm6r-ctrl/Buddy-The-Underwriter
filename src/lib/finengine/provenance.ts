/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 0
 *
 * Normalized provenance attribution for canonical financial facts.
 *
 * Before this module, every fact's attribution was reverse-engineered from a
 * free-text `provenance.source_ref`. There was no normalized `engine` /
 * `version` / `method` field, so multiple independent computation paths writing
 * the same `fact_key` were indistinguishable at the data layer — a model-
 * governance finding for an SR 11-7 platform.
 *
 * Phase 0 is ADDITIVE and changes NO computed value. It:
 *   1. Defines the normalized provenance fields (`engine`, `version`, `method`,
 *      `source_quality_rank`).
 *   2. Derives `engine` from the legacy `source_ref` via a seed map (extended
 *      after the §0.b census) so existing free-text attribution is normalized
 *      without touching the producers.
 *   3. Assigns a §2.3 source-quality rank (1 highest … 7 lowest) used by the
 *      conflict ledger to pick a single live value deterministically.
 *
 * Pure module — no DB, no server-only. Safe to import anywhere.
 */

import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";

/** Current canonical-core engine version. Bumped when the core math changes. */
export const FINENGINE_VERSION = "1.0.0" as const;

/**
 * §2.3 certified-fact source-authority ranking. 1 is the STRONGEST source; a
 * weaker (higher-number) source must never supersede a stronger one. Computed/
 * derived facts are not "sources" — they inherit the rank of their weakest
 * input upstream, but at the fact layer we rank them by producer trust below.
 */
export type SourceQualityRank = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * Normalized provenance fields added in Phase 0. These ride ALONGSIDE the
 * legacy free-text `source_ref` on `deal_financial_facts.provenance` — nothing
 * is removed. `FinancialFactProvenance` in `keys.ts` does not declare them, so
 * we carry them as an extension shape and merge into the jsonb at write time.
 */
export type NormalizedProvenance = {
  /** Normalized producer engine id, e.g. `finengine.core`, `legacy.noiPath`. */
  engine: string;
  /** Producer version, e.g. `1.0.0`, `v2`, `legacy`. */
  version: string;
  /** Optional method strategy that produced the value (Phase 2+). */
  method?: string;
  /** Optional fine-grained producer id (defaults to the legacy `extractor`). */
  producer?: string;
  /** §2.3 source-authority rank (1 strongest … 7 weakest). */
  source_quality_rank?: SourceQualityRank;
};

/** A provenance object that may already carry the normalized fields. */
export type StampedProvenance = FinancialFactProvenance & Partial<NormalizedProvenance>;

/**
 * Seed `source_ref` → engine map (SPEC Phase 0 table, extended with the live
 * §0.b census). Ordered most-specific-first; the first matching predicate wins.
 *
 * The `retireInPhase` column documents WHEN each legacy producer is retired so
 * the map doubles as the program's strangler-fig retirement ledger.
 */
type EngineRule = {
  test: (sourceRef: string) => boolean;
  engine: string;
  /** Documentation only — when this producer is retired. */
  retireInPhase: "Phase 0 (delete)" | "Phase 6" | "nucleus" | "keep";
};

const ENGINE_RULES: EngineRule[] = [
  // Hardcoded synthesis facts — retired (deleted) in Phase 0.
  { test: (s) => /^synthesis:golden_run:/.test(s), engine: "hardcode", retireInPhase: "Phase 0 (delete)" },
  { test: (s) => /^synthesis:canonical_alias:/.test(s), engine: "hardcode", retireInPhase: "Phase 0 (delete)" },
  // B4 global cash-flow producers — fold into the nucleus.
  { test: (s) => /^computeGlobalCashFlow:/.test(s), engine: "finengine.b4", retireInPhase: "nucleus" },
  { test: (s) => s === "deal_spreads:GLOBAL_CASH_FLOW", engine: "finengine.b4", retireInPhase: "nucleus" },
  // Legacy classic-spread C&I cash-flow ratio path — retired in Phase 6.
  { test: (s) => /^computed:classic_spread:/.test(s), engine: "legacy.classicSpread", retireInPhase: "Phase 6" },
  // Legacy CRE NOI ratio path — retired in Phase 6.
  { test: (s) => /^computed:noi\//.test(s), engine: "legacy.noiPath", retireInPhase: "Phase 6" },
  // Legacy stress path.
  { test: (s) => /^computed:stress:/.test(s), engine: "legacy.stress", retireInPhase: "Phase 6" },
  // Structural pricing / total-debt assembly.
  { test: (s) => /^deal_structural_pricing:/.test(s), engine: "legacy.structuralPricing", retireInPhase: "Phase 6" },
  { test: (s) => /^total_debt:/.test(s), engine: "legacy.structuralPricing", retireInPhase: "Phase 6" },
  // Tax-return-derived facts (od_detail backfill / reconciliation) — kept.
  { test: (s) => /^tax_return:/.test(s), engine: "extraction.taxReturn", retireInPhase: "keep" },
  // Manually-entered loan-request terms — kept.
  { test: (s) => /^deal_loan_requests:/.test(s), engine: "manual.loanRequest", retireInPhase: "keep" },
  // Spread renderers (T12 / balance sheet / PFS / other deal_spreads) — kept.
  { test: (s) => /^deal_spreads:/.test(s), engine: "finengine.spreads", retireInPhase: "keep" },
  // Document extraction outbox — kept (lowest-authority source layer).
  { test: (s) => /^deal_documents:/.test(s), engine: "extraction.docExtract", retireInPhase: "keep" },
];

/**
 * Resolve a normalized engine id from a legacy `source_ref`. Returns `unknown`
 * when no rule matches (surfaced in V-checks so the map can be extended).
 */
export function resolveEngineFromSourceRef(sourceRef: string | null | undefined): string {
  if (!sourceRef) return "unknown";
  for (const rule of ENGINE_RULES) {
    if (rule.test(sourceRef)) return rule.engine;
  }
  return "unknown";
}

/** Documentation accessor — the retirement phase for a given source_ref. */
export function retirementPhaseForSourceRef(sourceRef: string | null | undefined): string {
  if (!sourceRef) return "keep";
  for (const rule of ENGINE_RULES) {
    if (rule.test(sourceRef)) return rule.retireInPhase;
  }
  return "keep";
}

/**
 * Derive a producer version string. Honors an explicit `version`, else extracts
 * a `:vN` suffix from the source_ref/extractor, else `legacy` for known legacy
 * engines and `unversioned` otherwise.
 */
function deriveVersion(prov: StampedProvenance, engine: string): string {
  if (prov.version) return prov.version;
  const haystack = `${prov.extractor ?? ""} ${prov.source_ref ?? ""}`;
  const m = haystack.match(/:v(\d+(?:\.\d+)*)/);
  if (m) return `v${m[1]}`;
  if (engine.startsWith("finengine.")) return FINENGINE_VERSION;
  if (engine === "hardcode" || engine === "unknown") return "unversioned";
  return "legacy";
}

/**
 * §2.3 source-quality rank inference. Best-effort from the fields available on
 * a fact at write/backfill time. Document-sourced facts are ranked by their
 * `source_canonical_type`; computed/derived facts are ranked by producer trust;
 * the hardcoded golden-run fact is pinned to the WEAKEST rank so it can never
 * win a conflict (per decision D3 / §2.3).
 */
export function inferSourceQualityRank(args: {
  sourceType?: string | null;
  sourceCanonicalType?: string | null;
  sourceRef?: string | null;
  engine?: string;
  confidence?: number | null;
}): SourceQualityRank {
  const engine = args.engine ?? resolveEngineFromSourceRef(args.sourceRef);
  if (engine === "hardcode") return 7;

  const ct = (args.sourceCanonicalType ?? "").toUpperCase();
  const ref = (args.sourceRef ?? "").toLowerCase();

  // 1 — IRS-verified transcript (4506-C) / audited statement.
  if (ct.includes("4506") || ct.includes("TRANSCRIPT") || ct.includes("AUDITED")) return 1;
  // 2 — filed tax return (1120 / 1120S / 1065 / 1040 + K-1).
  if (ct.includes("TAX_RETURN") || /\b(1120s?|1065|1040)\b/.test(ct) || ref.startsWith("tax_return:")) return 2;
  // 3 — borrower-entered loan-request terms (manual).
  if (ref.startsWith("deal_loan_requests:")) return 3;
  // 3 — borrower-signed statement / PFS / borrowing-base cert / appraisal / lien.
  if (
    ct.includes("PERSONAL_FINANCIAL_STATEMENT") ||
    ct.includes("PFS") ||
    ct.includes("APPRAISAL") ||
    ct.includes("BORROWING_BASE") ||
    ct.includes("LIEN") ||
    ct.includes("SIGNED")
  )
    return 3;
  // 4 — CPA-reviewed or compiled statement.
  if (ct.includes("REVIEWED") || ct.includes("COMPILED") || ct.includes("FINANCIAL_STATEMENT")) return 4;
  // 5 — bank statement / AR aging (corroborating).
  if (ct.includes("BANK_STATEMENT") || ct.includes("AR_AGING") || ct.includes("AGING")) return 5;

  // Computed/derived facts (SPREAD / STRUCTURAL / synthesis) are ranked by
  // producer trust: the canonical core and B4 producers above legacy paths.
  if (engine.startsWith("finengine.")) return 4;
  if (engine.startsWith("legacy.")) return 5;

  // Document extraction with no canonical type — rank by confidence (strong vs
  // weak OCR micro-fact).
  if (ref.startsWith("deal_documents:")) {
    const conf = args.confidence ?? null;
    return conf != null && conf >= 0.7 ? 6 : 7;
  }
  return 6;
}

/**
 * Stamp normalized provenance fields onto a provenance object WITHOUT mutating
 * the caller's object and WITHOUT altering any existing field. Idempotent: an
 * already-stamped engine/version is preserved.
 *
 * This is the single function the canonical write chokepoint calls so EVERY
 * fact write carries `engine` + `version` (guard G2).
 */
export function stampProvenance(
  prov: StampedProvenance,
  ctx?: { sourceCanonicalType?: string | null; method?: string },
): StampedProvenance {
  const engine = prov.engine ?? resolveEngineFromSourceRef(prov.source_ref);
  const version = deriveVersion(prov, engine);
  const rank =
    prov.source_quality_rank ??
    inferSourceQualityRank({
      sourceType: prov.source_type,
      sourceCanonicalType: ctx?.sourceCanonicalType ?? null,
      sourceRef: prov.source_ref,
      engine,
      confidence: prov.confidence ?? null,
    });
  return {
    ...prov,
    engine,
    version,
    method: prov.method ?? ctx?.method,
    producer: prov.producer ?? prov.extractor ?? engine,
    source_quality_rank: rank,
  };
}
