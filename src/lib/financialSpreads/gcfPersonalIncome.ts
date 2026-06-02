/**
 * SPEC-GCF-SOURCE-OF-TRUTH-AUDIT-AND-CONSOLIDATION-1
 *
 * Single source of truth for the Global Cash Flow "personal income build-up".
 *
 * Per SBA SOP 50 10, GCF personal income is the owner's income from sources
 * OUTSIDE the guaranteed entity. K-1 pass-through income is intentionally
 * EXCLUDED — it is already captured in business EBITDA, so including it (or the
 * AGI aggregate TOTAL_PERSONAL_INCOME) double-counts pass-through income/loss
 * and produces materially wrong global cash flow.
 *
 * Both producers — the GCF spread template (globalCashFlow.ts) and the
 * pure-function persistence path (persistGlobalCashFlow.ts) — MUST derive
 * personal income from this same component list so the rendered spread and the
 * canonical facts agree by construction. This module is intentionally pure (no
 * "server-only") so the invariant can be unit-tested.
 */

/** Income components that make up GCF personal income (K-1 excluded). */
export const GCF_PERSONAL_INCOME_COMPONENT_KEYS = [
  "WAGES_W2",
  "SCH_E_RENTAL_TOTAL",
  "SCH_E_NET",
  "TAXABLE_INTEREST",
  "ORDINARY_DIVIDENDS",
  "SOCIAL_SECURITY",
  "IRA_DISTRIBUTIONS",
  "PENSION_ANNUITY",
  "SCHED_C_NET",
] as const;

/**
 * Pass-through / K-1 keys that MUST NEVER be summed into GCF personal income.
 * Kept here so a guard test can assert the component list never overlaps it.
 */
export const GCF_K1_EXCLUDED_KEYS = new Set<string>([
  "SCH_E_K1_PASSIVE_INCOME",
  "SCH_E_K1_NONPASSIVE_INCOME",
  "K1_ORDINARY_INCOME",
  "TOTAL_PERSONAL_INCOME", // AGI aggregate — bundles K-1; never use directly.
]);

export type GcfPersonalIncomeFact = {
  owner_type?: string | null;
  owner_entity_id?: string | null;
  fact_type?: string | null;
  fact_key?: string | null;
  fact_value_num?: number | null;
  fact_period_end?: string | null;
  created_at?: string | null;
};

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/** Recency key for picking the latest fact within an owner. */
function recencyOf(f: GcfPersonalIncomeFact): string {
  return f.fact_period_end ?? f.created_at ?? "";
}

/** Sum one component key, grouping by owner and picking the latest per owner. */
function sumComponentByOwner(
  scoped: GcfPersonalIncomeFact[],
  factKey: string,
): { value: number | null; asOf: string | null } {
  const byOwner = new Map<string | null, GcfPersonalIncomeFact[]>();
  for (const f of scoped) {
    if (f.fact_key !== factKey) continue;
    const oid = f.owner_entity_id ?? null;
    if (!byOwner.has(oid)) byOwner.set(oid, []);
    byOwner.get(oid)!.push(f);
  }

  let total = 0;
  let present = false;
  let asOf: string | null = null;
  for (const [, ownerFacts] of byOwner) {
    let best: GcfPersonalIncomeFact | null = null;
    for (const f of ownerFacts) {
      if (typeof f.fact_value_num !== "number" || !Number.isFinite(f.fact_value_num)) continue;
      if (!best || recencyOf(f) >= recencyOf(best)) best = f;
    }
    if (best && typeof best.fact_value_num === "number") {
      total += best.fact_value_num;
      present = true;
      asOf = maxIso(asOf, best.fact_period_end ?? null);
    }
  }
  return { value: present ? total : null, asOf };
}

/**
 * Sum GCF personal income from individual components (K-1 excluded), applying
 * the SCH_E_RENTAL_TOTAL-over-SCH_E_NET preference to avoid double-counting
 * rental income bundled into the combined Schedule E net figure.
 *
 * @param ownerEntityId optional — restrict to a single PERSONAL owner (the
 *   persist path computes per-sponsor); when omitted, sums across all PERSONAL
 *   owners (the spread template's deal-wide aggregation).
 */
export function sumGcfPersonalIncome(
  facts: GcfPersonalIncomeFact[],
  opts: { ownerEntityId?: string } = {},
): { value: number | null; asOf: string | null; components: Record<string, number> } {
  const scoped = facts.filter(
    (f) =>
      f.owner_type === "PERSONAL" &&
      f.fact_type === "PERSONAL_INCOME" &&
      (opts.ownerEntityId == null || (f.owner_entity_id ?? null) === opts.ownerEntityId),
  );

  const hasRentalTotal = scoped.some(
    (f) =>
      f.fact_key === "SCH_E_RENTAL_TOTAL" &&
      typeof f.fact_value_num === "number" &&
      Number.isFinite(f.fact_value_num),
  );

  let total = 0;
  let present = false;
  let asOf: string | null = null;
  const components: Record<string, number> = {};

  for (const key of GCF_PERSONAL_INCOME_COMPONENT_KEYS) {
    // Prefer explicit rental total over combined Schedule E net (K-1 contamination).
    if (key === "SCH_E_NET" && hasRentalTotal) continue;
    if (key === "SCH_E_RENTAL_TOTAL" && !hasRentalTotal) continue;

    const sum = sumComponentByOwner(scoped, key);
    if (sum.value !== null) {
      total += sum.value;
      present = true;
      components[key] = sum.value;
      asOf = maxIso(asOf, sum.asOf);
    }
  }

  return { value: present ? total : null, asOf, components };
}
