/**
 * SPEC-FINENGINE-RECONCILIATION-MATRIX-1 §2 — deal-set resolver (pure).
 *
 * Enumerates the candidate deals the reconciliation matrix sweeps, filtered by
 * product (`deal_type`), bank, and populated-ness. PURE: the SCRIPT performs the DB
 * read (deals + a distinct non-superseded fact count per deal) and injects the rows;
 * this module only filters/sorts them. Read-only (NG1).
 *
 * Honest scope (§0.4): the resolver returns whatever the data contains — it never
 * asserts an 8-product universe. `onlyPopulated`/`minFacts` drop 0-fact shells and
 * thin deals that cannot exercise the harnesses (R2).
 */

export type DealSetEntry = {
  dealId: string;
  name: string;
  dealType: string;
  bankId: string | null;
  stage: string;
  /** Distinct non-superseded `deal_financial_facts.fact_key` count — populated-ness proxy. */
  factCount: number;
};

export type DealSetFilter = {
  dealType?: string;
  bankId?: string;
  /** Drop 0-fact shells (default true). */
  onlyPopulated?: boolean;
  /** Minimum distinct fact count to exercise the harnesses (default 50). */
  minFacts?: number;
};

const DEFAULT_MIN_FACTS = 50;

/**
 * Filter + stably sort an injected list of deal rows.
 * Sort: fact count desc (richest first), then dealId asc (stable tie-break).
 */
export function resolveDealSet(deals: DealSetEntry[], filter?: DealSetFilter): DealSetEntry[] {
  const onlyPopulated = filter?.onlyPopulated ?? true;
  const minFacts = filter?.minFacts ?? DEFAULT_MIN_FACTS;

  return deals
    .filter((d) => {
      if (filter?.dealType && d.dealType !== filter.dealType) return false;
      if (filter?.bankId && d.bankId !== filter.bankId) return false;
      if (onlyPopulated && d.factCount <= 0) return false;
      if (d.factCount < minFacts) return false;
      return true;
    })
    .sort((a, b) => b.factCount - a.factCount || (a.dealId < b.dealId ? -1 : a.dealId > b.dealId ? 1 : 0));
}
