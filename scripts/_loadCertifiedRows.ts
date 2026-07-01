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
  "fact_key, fact_value_num, fact_period_end, fact_period_start, owner_type, is_superseded, source_canonical_type, confidence, provenance, source_document_id, created_at";

/** Load one deal's certified fact rows (verbatim shape the three scripts shared). */
export async function loadCertifiedRows(dealId: string): Promise<CertifiedFactRow[]> {
  const sb = supabaseAdmin();
  const { data, error } = await (sb as any)
    .from("deal_financial_facts")
    .select(FACT_SELECT)
    .eq("deal_id", dealId);
  if (error) throw new Error(`load ${dealId}: ${error.message}`);
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

  const { data: facts, error: fErr } = await (sb as any)
    .from("deal_financial_facts")
    .select("deal_id, fact_key")
    .eq("is_superseded", false);
  if (fErr) throw new Error(`load fact counts: ${fErr.message}`);

  const byDeal = new Map<string, Set<string>>();
  for (const f of (facts ?? []) as { deal_id: string; fact_key: string }[]) {
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
