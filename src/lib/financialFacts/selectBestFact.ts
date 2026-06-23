/**
 * selectBestFact — shared fact selection utility.
 *
 * SPEC-FACT-DISAMBIGUATION-1: Extracted from financialSnapshotCore.ts so
 * all consumers (aggregator, GCF persist, snapshot builder) use the same
 * priority logic. Never re-implement this inline.
 *
 * Priority order (highest wins):
 *   1. MANUAL     — banker-entered override
 *   2. STRUCTURAL — system-computed from structural pricing / rules
 *   3. SPREAD     — spread-derived / backfilled
 *   4. DOC_EXTRACT — raw document extraction
 *
 * Tiebreakers (in order):
 *   - as_of_date DESC (most recent period)
 *   - confidence DESC
 *   - created_at DESC
 *   - id ASC (stable deterministic fallback)
 */

export type SelectableFact = {
  id: string;
  fact_type: string;
  fact_key: string;
  fact_period_start: string | null;
  fact_period_end: string | null;
  fact_value_num: number | null;
  fact_value_text: string | null;
  confidence: number | null;
  provenance: any;
  created_at: string;
  source_canonical_type?: string | null;
};

function toIsoDatePrefix(s: unknown): string | null {
  if (!s) return null;
  const str = String(s);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  return null;
}

export function factAsOfDate(f: SelectableFact): string | null {
  const provAsOf = toIsoDatePrefix(f.provenance?.as_of_date);
  if (provAsOf) return provAsOf;
  const pe = toIsoDatePrefix(f.fact_period_end);
  if (pe) return pe;
  const ps = toIsoDatePrefix(f.fact_period_start);
  if (ps) return ps;
  return null;
}

export type SourceType = "MANUAL" | "STRUCTURAL" | "SPREAD" | "DOC_EXTRACT" | "UNKNOWN";

export function factSourceType(f: SelectableFact): SourceType {
  const raw = String(f.provenance?.source_type ?? "").toUpperCase();
  if (raw === "MANUAL") return "MANUAL";
  if (raw === "STRUCTURAL") return "STRUCTURAL";
  if (raw === "SPREAD") return "SPREAD";
  if (raw === "DOC_EXTRACT") return "DOC_EXTRACT";
  return "UNKNOWN";
}

function sourcePriority(st: SourceType): number {
  switch (st) {
    case "MANUAL":     return 4;
    case "STRUCTURAL": return 3;
    case "SPREAD":     return 2;
    case "DOC_EXTRACT": return 1;
    default:           return 0;
  }
}

export function selectBestFact<T extends SelectableFact>(
  facts: T[],
): { chosen: T | null; rejected: T[] } {
  if (facts.length === 0) return { chosen: null, rejected: [] };

  const sorted = facts.slice().sort((a, b) => {
    // 1. Source priority
    const pa = sourcePriority(factSourceType(a));
    const pb = sourcePriority(factSourceType(b));
    if (pa !== pb) return pb - pa;

    // 2. Most recent period
    const da = factAsOfDate(a) ?? "";
    const db = factAsOfDate(b) ?? "";
    if (da !== db) return db < da ? -1 : db > da ? 1 : 0;

    // 3. Higher confidence
    const ca = typeof a.confidence === "number" ? a.confidence : -1;
    const cb = typeof b.confidence === "number" ? b.confidence : -1;
    if (ca !== cb) return cb - ca;

    // 4. Most recently written
    const ta = a.created_at ?? "";
    const tb = b.created_at ?? "";
    if (ta !== tb) return tb < ta ? -1 : tb > ta ? 1 : 0;

    // 5. Stable ID tiebreak
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { chosen: sorted[0] ?? null, rejected: sorted.slice(1) };
}
