/**
 * SPEC-FINENGINE-RECONCILIATION-MATRIX-1 §1 — shared certified-rows loader.
 *
 * The three finengine shadow scripts (full-spread, global cash flow, decision-core)
 * loaded a deal's `deal_financial_facts` with an IDENTICAL select list and mapping.
 * That body lives here once so the select list — including `fact_period_start` (the
 * period-selection fix relies on it; supabase-js silently drops unlisted columns) —
 * has a single source of truth. Script-land: the DB read (lazy `supabaseAdmin`) is
 * allowed here; the `src/lib/finengine/shadow` modules stay pure (NG1).
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";
import type { DealSetEntry } from "@/lib/finengine/shadow/reconciliationDealSet";

/** The certified-fact projection every shadow harness consumes. */
const FACT_SELECT =
  "id, fact_key, fact_value_num, fact_period_end, fact_period_start, owner_type, is_superseded, source_canonical_type, confidence, provenance, source_document_id, created_at";

const PAGE_SIZE = 1000; // supabase-js default row cap — page past it or the read silently truncates.

/**
 * Fetch EVERY row a query would return, paging past supabase-js's 1000-row default cap
 * (verified: the deal set's non-superseded facts exceed 1000 rows, so a single
 * `.select()` truncates — undercounting fact totals and DROPPING whole deals). Orders by
 * the unique `id` so pages don't overlap or skip. `makeQuery` is re-invoked per page
 * because a builder can't be reused after `await`.
 */
async function fetchAllRows<T>(makeQuery: () => any, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return out;
}

/** Load one deal's certified fact rows (verbatim shape the three scripts shared). */
export async function loadCertifiedRows(dealId: string): Promise<CertifiedFactRow[]> {
  const sb = supabaseAdmin();
  const data = await fetchAllRows<any>(
    () => (sb as any).from("deal_financial_facts").select(FACT_SELECT).eq("deal_id", dealId),
    `load ${dealId}`,
  );
  return (data ?? []).map((r: any) => ({
    fact_key: r.fact_key,
    fact_value_num: r.fact_value_num,
    fact_period_end: r.fact_period_end,
    fact_period_start: r.fact_period_start ?? null,
    owner_type: r.owner_type,
    is_superseded: r.is_superseded,
    source_canonical_type: r.source_canonical_type ?? null,
    confidence: r.confidence ?? null,
    extractor: r.provenance?.extractor ?? null,
    source_document_id: r.source_document_id ?? null,
    created_at: r.created_at ?? null,
  })) as CertifiedFactRow[];
}

/**
 * Enumerate all deals with their distinct non-superseded fact count (populated-ness
 * proxy). Read-only; the pure `resolveDealSet` filters/sorts the returned rows.
 */
export async function loadDealSetEntries(): Promise<DealSetEntry[]> {
  const sb = supabaseAdmin();
  const { data: deals, error } = await (sb as any)
    .from("deals")
    .select("id, name, deal_type, bank_id, stage");
  if (error) throw new Error(`load deals: ${error.message}`);

  // Page past the 1000-row cap — the aggregate fact scan spans all deals (~1.5k+ rows),
  // so an unpaged read truncates and silently drops deals from the sweep.
  const facts = await fetchAllRows<{ deal_id: string; fact_key: string }>(
    () => (sb as any).from("deal_financial_facts").select("id, deal_id, fact_key").eq("is_superseded", false),
    "load fact counts",
  );

  const byDeal = new Map<string, Set<string>>();
  for (const f of facts as { deal_id: string; fact_key: string }[]) {
    const set = byDeal.get(f.deal_id) ?? new Set<string>();
    set.add(f.fact_key);
    byDeal.set(f.deal_id, set);
  }

  return ((deals ?? []) as any[]).map((d) => ({
    dealId: d.id,
    name: d.name ?? "(unnamed)",
    dealType: d.deal_type ?? "UNKNOWN",
    bankId: d.bank_id ?? null,
    stage: d.stage ?? "",
    factCount: byDeal.get(d.id)?.size ?? 0,
  })) as DealSetEntry[];
}
