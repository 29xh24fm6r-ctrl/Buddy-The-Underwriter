/**
 * SPEC-FINANCIAL-READINESS-GCF-PREREQ-REPAIR-1
 *
 * Pure core of the deterministic financial-readiness prerequisite repair layer —
 * NO "server-only", so it is unit-testable without a database. The server-only
 * orchestrator (ensureFinancialReadinessPrerequisites.ts) loads facts/pricing,
 * delegates the *decisions* here, then performs the writes.
 *
 * This core NEVER invents values. It decides:
 *   1. whether ANNUAL_DEBT_SERVICE must be (re)computed from latest structural
 *      pricing (missing, or its proposed component is stale vs. current pricing),
 *   2. whether PFS_ANNUAL_DEBT_SERVICE can be derived from already-accepted PFS
 *      monthly-payment facts (monthly × 12), and
 *   3. whether PFS_LIVING_EXPENSES can be derived from an already-accepted
 *      source-backed living-expense fact under a recognized alternate key.
 *
 * Anything not deterministically derivable from accepted upstream data stays
 * unrepaired (fail-closed) with a precise diagnostic.
 */

export type PrereqFactRow = {
  fact_key: string;
  fact_value_num: number | null;
  owner_type?: string | null;
  owner_entity_id?: string | null;
  source_document_id?: string | null;
  fact_period_start?: string | null;
  fact_period_end?: string | null;
  confidence?: number | null;
  is_superseded?: boolean | null;
};

/** Canonical target keys this layer repairs. */
export const ANNUAL_DEBT_SERVICE_KEY = "ANNUAL_DEBT_SERVICE";
export const ANNUAL_DEBT_SERVICE_PROPOSED_KEY = "ANNUAL_DEBT_SERVICE_PROPOSED";
export const PFS_ANNUAL_DEBT_SERVICE_KEY = "PFS_ANNUAL_DEBT_SERVICE";
export const PFS_LIVING_EXPENSES_KEY = "PFS_LIVING_EXPENSES";

/**
 * Aggregate monthly mortgage payment — the explicit total that already rolls up
 * the per-property real-estate lines. Preferred over summing per-property lines
 * to avoid double-counting.
 */
export const PFS_MORTGAGE_PAYMENT_MO_KEY = "PFS_MORTGAGE_PAYMENT_MO";
/** Per-property monthly real-estate payment lines, e.g. PFS_RE1_MONTHLY_PAYMENT. */
export const PFS_RE_MONTHLY_PAYMENT_RE = /^PFS_RE\d+_MONTHLY_PAYMENT$/;

/** Recognized alternate keys for an already-extracted personal living-expense fact. */
export const PFS_LIVING_EXPENSES_ANNUAL_KEYS = [
  "PFS_ANNUAL_LIVING_EXPENSES",
  "PFS_LIVING_EXPENSES_ANNUAL",
  "PFS_TOTAL_ANNUAL_LIVING_EXPENSES",
];
export const PFS_LIVING_EXPENSES_MONTHLY_KEYS = [
  "PFS_MONTHLY_LIVING_EXPENSES",
  "PFS_LIVING_EXPENSES_MO",
  "PFS_LIVING_EXPENSES_MONTHLY",
];

function isActiveNumeric(f: PrereqFactRow): boolean {
  return f.is_superseded !== true && typeof f.fact_value_num === "number" && Number.isFinite(f.fact_value_num);
}

function recency(f: PrereqFactRow): string {
  return f.fact_period_end ?? "";
}

/** Latest active numeric fact for a key (optionally constrained to an owner). */
export function latestActiveFact(
  facts: PrereqFactRow[],
  factKey: string,
  opts?: { ownerType?: string; ownerEntityId?: string },
): PrereqFactRow | null {
  const matches = facts.filter(
    (f) =>
      f.fact_key === factKey &&
      isActiveNumeric(f) &&
      (opts?.ownerType == null || f.owner_type === opts.ownerType) &&
      (opts?.ownerEntityId == null || f.owner_entity_id === opts.ownerEntityId),
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => recency(b).localeCompare(recency(a)));
  return matches[0];
}

export function hasActiveFact(
  facts: PrereqFactRow[],
  factKey: string,
  opts?: { ownerType?: string; ownerEntityId?: string },
): boolean {
  return latestActiveFact(facts, factKey, opts) != null;
}

// ── 1+2. ANNUAL_DEBT_SERVICE repair decision ───────────────────────────────

export type AnnualDebtServiceRepairPlan = {
  /** When true the orchestrator should run computeTotalDebtService. */
  shouldRecompute: boolean;
  reason:
    | "current" // ANNUAL_DEBT_SERVICE present and proposed component matches current pricing
    | "annual_debt_service_missing"
    | "annual_debt_service_proposed_stale"
    | "no_structural_pricing"; // nothing to compute from — route to pricing
};

/**
 * Decide whether ANNUAL_DEBT_SERVICE needs (re)materialization.
 *
 * - Missing total → recompute.
 * - Total present but its PROPOSED component disagrees with the latest structural
 *   pricing's annual_debt_service_est (stale old ADS outranking newer pricing) →
 *   recompute so current pricing wins.
 * - No structural pricing ADS at all and ADS missing → cannot compute; caller
 *   routes the banker to pricing/loan terms (fail-closed, never invents).
 */
export function planAnnualDebtServiceRepair(args: {
  facts: PrereqFactRow[];
  latestStructuralAds: number | null;
}): AnnualDebtServiceRepairPlan {
  const { facts, latestStructuralAds } = args;
  const hasTotal = hasActiveFact(facts, ANNUAL_DEBT_SERVICE_KEY);

  if (!hasTotal) {
    if (latestStructuralAds == null) {
      return { shouldRecompute: false, reason: "no_structural_pricing" };
    }
    return { shouldRecompute: true, reason: "annual_debt_service_missing" };
  }

  // Total exists — check the proposed component against current pricing.
  const proposed = latestActiveFact(facts, ANNUAL_DEBT_SERVICE_PROPOSED_KEY);
  if (
    latestStructuralAds != null &&
    proposed?.fact_value_num != null &&
    !valuesClose(Number(proposed.fact_value_num), latestStructuralAds)
  ) {
    return { shouldRecompute: true, reason: "annual_debt_service_proposed_stale" };
  }

  return { shouldRecompute: false, reason: "current" };
}

/** Relative-tolerance equality for currency amounts (1 cent or 0.01% slack). */
export function valuesClose(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  if (diff <= 0.01) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 && diff / scale <= 0.0001;
}

// ── 3+4. PFS_ANNUAL_DEBT_SERVICE derivation (per personal owner) ────────────

export type PfsDerivation = {
  ownerEntityId: string | null;
  value: number;
  calc: string;
  sourceDocumentId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  confidence: number;
};

export type PfsDeriveResult = {
  derivations: PfsDerivation[];
  /** Set when nothing could be derived. */
  diagnostic: string | null;
};

function personalOwners(facts: PrereqFactRow[]): string[] {
  const owners = new Set<string>();
  for (const f of facts) {
    if (f.owner_type === "PERSONAL" && f.owner_entity_id) owners.add(f.owner_entity_id);
  }
  return [...owners];
}

/**
 * Derive PFS_ANNUAL_DEBT_SERVICE from accepted PFS monthly-payment facts, per
 * personal owner that does not already have it.
 *
 * Double-counting policy: prefer the aggregate PFS_MORTGAGE_PAYMENT_MO (it is the
 * total mortgage payment, which already includes the per-property lines). Only
 * when no aggregate mortgage payment exists do we sum the distinct
 * PFS_RE*_MONTHLY_PAYMENT property lines. Annual = monthly × 12.
 *
 * Never derives from balances (PFS_TOTAL_LIABILITIES, PFS_MORTGAGES, …) — only
 * from explicit monthly *payment* facts. Returns no derivation (fail-closed) for
 * owners with no monthly-payment source fact.
 */
export function derivePfsAnnualDebtServiceByOwner(facts: PrereqFactRow[]): PfsDeriveResult {
  const owners = personalOwners(facts);
  const derivations: PfsDerivation[] = [];

  for (const ownerEntityId of owners) {
    if (hasActiveFact(facts, PFS_ANNUAL_DEBT_SERVICE_KEY, { ownerType: "PERSONAL", ownerEntityId })) {
      continue; // already present — nothing to repair for this owner
    }

    const mortgage = latestActiveFact(facts, PFS_MORTGAGE_PAYMENT_MO_KEY, {
      ownerType: "PERSONAL",
      ownerEntityId,
    });

    let monthly: number | null = null;
    let calc: string;
    let source: PrereqFactRow | null = null;

    if (mortgage?.fact_value_num != null) {
      monthly = Number(mortgage.fact_value_num);
      source = mortgage;
      calc = `${PFS_MORTGAGE_PAYMENT_MO_KEY} (${monthly}) × 12 = ${monthly * 12}`;
    } else {
      const reLines = facts.filter(
        (f) =>
          PFS_RE_MONTHLY_PAYMENT_RE.test(f.fact_key) &&
          f.owner_type === "PERSONAL" &&
          f.owner_entity_id === ownerEntityId &&
          isActiveNumeric(f),
      );
      if (reLines.length > 0) {
        monthly = reLines.reduce((sum, f) => sum + Number(f.fact_value_num), 0);
        source = reLines[0];
        const parts = reLines.map((f) => `${f.fact_key} (${f.fact_value_num})`).join(" + ");
        calc = `${parts} = ${monthly}/mo × 12 = ${monthly * 12}`;
      } else {
        continue; // no monthly-payment source fact for this owner — fail closed
      }
    }

    if (monthly == null || !(monthly > 0)) continue;

    derivations.push({
      ownerEntityId,
      value: monthly * 12,
      calc,
      sourceDocumentId: source?.source_document_id ?? null,
      periodStart: source?.fact_period_start ?? null,
      periodEnd: source?.fact_period_end ?? null,
      // Conservative for a derived value; never claim more than the source.
      confidence: Math.min(0.65, source?.confidence ?? 0.65),
    });
  }

  return {
    derivations,
    diagnostic:
      derivations.length === 0
        ? "PFS_ANNUAL_DEBT_SERVICE not derivable from existing facts; no PFS monthly-payment fact found — extraction/manual review required."
        : null,
  };
}

// ── 5. PFS_LIVING_EXPENSES derivation (per personal owner) ──────────────────

/**
 * Derive PFS_LIVING_EXPENSES ONLY when a source-backed living-expense fact
 * already exists under a recognized alternate key (annual copied as-is, monthly
 * × 12). NEVER invents a value and NEVER parses raw OCR. When no such fact
 * exists the owner is left unrepaired with a precise diagnostic (fail-closed).
 */
export function derivePfsLivingExpensesByOwner(facts: PrereqFactRow[]): PfsDeriveResult {
  const owners = personalOwners(facts);
  const derivations: PfsDerivation[] = [];

  for (const ownerEntityId of owners) {
    if (hasActiveFact(facts, PFS_LIVING_EXPENSES_KEY, { ownerType: "PERSONAL", ownerEntityId })) {
      continue;
    }

    let annual: number | null = null;
    let calc: string | null = null;
    let source: PrereqFactRow | null = null;

    for (const key of PFS_LIVING_EXPENSES_ANNUAL_KEYS) {
      const f = latestActiveFact(facts, key, { ownerType: "PERSONAL", ownerEntityId });
      if (f?.fact_value_num != null) {
        annual = Number(f.fact_value_num);
        source = f;
        calc = `mapped from ${key} (${annual})`;
        break;
      }
    }

    if (annual == null) {
      for (const key of PFS_LIVING_EXPENSES_MONTHLY_KEYS) {
        const f = latestActiveFact(facts, key, { ownerType: "PERSONAL", ownerEntityId });
        if (f?.fact_value_num != null) {
          const monthly = Number(f.fact_value_num);
          annual = monthly * 12;
          source = f;
          calc = `${key} (${monthly}) × 12 = ${annual}`;
          break;
        }
      }
    }

    if (annual == null || calc == null || !(annual > 0)) continue;

    derivations.push({
      ownerEntityId,
      value: annual,
      calc,
      sourceDocumentId: source?.source_document_id ?? null,
      periodStart: source?.fact_period_start ?? null,
      periodEnd: source?.fact_period_end ?? null,
      confidence: Math.min(0.6, source?.confidence ?? 0.6),
    });
  }

  return {
    derivations,
    diagnostic:
      derivations.length === 0
        ? "PFS_LIVING_EXPENSES not repairable from existing facts; extraction/manual review required."
        : null,
  };
}
