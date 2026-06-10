import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildSpreadColumns,
  type CanonicalSpreadViewModel,
  type SpreadColumnFact,
} from "@/lib/spreads/canonicalSpreadViewModel";
import type { ReconcileFact } from "@/lib/financialFacts/reconcileFinancialFacts";

/**
 * SPEC-SPREAD-SOURCE-OF-TRUTH-UNIFICATION-1 — the single reconciled, source-attributed
 * spread view model. All spread surfaces should derive period source attribution +
 * reconciled fact selection from here rather than inferring source from dates/fact keys.
 * Read-only; never throws.
 */
export async function buildCanonicalSpreadViewModel(
  dealId: string,
  bankId: string,
): Promise<CanonicalSpreadViewModel> {
  try {
    const sb = supabaseAdmin();
    const { data: rows } = await (sb as any)
      .from("deal_financial_facts")
      .select(
        "id, fact_key, fact_value_num, fact_period_start, fact_period_end, owner_type, owner_entity_id, source_document_id, source_canonical_type, confidence, provenance",
      )
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .not("fact_value_num", "is", null);

    const input: (ReconcileFact & SpreadColumnFact)[] = ((rows ?? []) as any[]).map((r) => ({
      id: r.id ?? null,
      fact_key: r.fact_key,
      fact_period_start: r.fact_period_start ?? null,
      fact_period_end: r.fact_period_end ?? null,
      owner_type: r.owner_type,
      owner_entity_id: r.owner_entity_id ?? null,
      source_document_id: r.source_document_id ?? null,
      source_canonical_type: r.source_canonical_type ?? null,
      confidence: r.confidence ?? null,
      extractor: r.provenance?.extractor ?? null,
      fact_value_num: r.fact_value_num !== null ? Number(r.fact_value_num) : null,
    }));

    return buildSpreadColumns(input);
  } catch {
    return {
      columns: [],
      selectedFacts: [],
      rejectedFacts: [],
      confidenceTier: "blocked",
      caveats: ["Spread view model unavailable — fact load failed."],
      gcfPreliminary: true,
    };
  }
}
