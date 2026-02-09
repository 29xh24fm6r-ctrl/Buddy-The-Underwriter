import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { FinancialFactProvenance } from "@/lib/financialFacts/keys";

/** Sentinel values matching NOT NULL DEFAULT in the DB schema. */
export const SENTINEL_UUID = "00000000-0000-0000-0000-000000000000";
export const SENTINEL_DATE = "1900-01-01";

export async function upsertDealFinancialFact(args: {
  dealId: string;
  bankId: string;
  sourceDocumentId: string | null;

  factType: string;
  factKey: string;

  factValueNum: number | null;
  factValueText?: string | null;

  confidence: number | null;
  currency?: string;

  factPeriodStart?: string | null;
  factPeriodEnd?: string | null;

  provenance: FinancialFactProvenance;

  ownerType?: string;
  ownerEntityId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = supabaseAdmin();

    const row = {
      deal_id: args.dealId,
      bank_id: args.bankId,
      source_document_id: args.sourceDocumentId ?? SENTINEL_UUID,
      fact_type: args.factType,
      fact_key: args.factKey,
      fact_period_start: args.factPeriodStart ?? SENTINEL_DATE,
      fact_period_end: args.factPeriodEnd ?? SENTINEL_DATE,
      fact_value_num: args.factValueNum,
      fact_value_text: args.factValueText ?? null,
      currency: args.currency ?? "USD",
      confidence: args.confidence,
      provenance: args.provenance,
      owner_type: args.ownerType ?? "DEAL",
      owner_entity_id: args.ownerEntityId ?? SENTINEL_UUID,
    };

    const { error } = await (sb as any)
      .from("deal_financial_facts")
      .upsert(row, {
        onConflict:
          "deal_id,bank_id,source_document_id,fact_type,fact_key,fact_period_start,fact_period_end,owner_type,owner_entity_id",
      } as any);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
