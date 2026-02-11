import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealFinancialFact, SENTINEL_UUID } from "@/lib/financialFacts/writeFact";

export type TotalDebtServiceResult = {
  proposed: number | null;
  existing: number | null;
  total: number | null;
  dscr: number | null;
  gcf_dscr: number | null;
};

/**
 * Aggregate total debt service: proposed (structural pricing) + existing debt schedule.
 *
 * Writes 3 canonical facts:
 *   - ANNUAL_DEBT_SERVICE_PROPOSED (confidence 0.90, source_type STRUCTURAL)
 *   - ANNUAL_DEBT_SERVICE_EXISTING (confidence 0.90, source_type STRUCTURAL)
 *   - ANNUAL_DEBT_SERVICE (confidence 0.90, source_type STRUCTURAL) — the TOTAL
 *
 * If NOI fact is available, also computes and writes DSCR.
 * If GCF fact is available, also computes and writes GCF_DSCR.
 *
 * Never throws.
 */
export async function computeTotalDebtService(args: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: true; data: TotalDebtServiceResult } | { ok: false; error: string }> {
  const { dealId, bankId } = args;

  try {
    const sb = supabaseAdmin();

    // Step 1: Get latest proposed ADS from structural pricing
    const { data: spRow, error: spErr } = await (sb as any)
      .from("deal_structural_pricing")
      .select("annual_debt_service_est")
      .eq("deal_id", dealId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (spErr) {
      return { ok: false, error: `structural_pricing query: ${spErr.message}` };
    }

    const proposed: number | null = spRow?.annual_debt_service_est ?? null;

    // Step 2: Sum existing debt (included_in_global = true, not being refinanced)
    const { data: existingRows, error: exErr } = await (sb as any)
      .from("deal_existing_debt_schedule")
      .select("annual_debt_service, monthly_payment")
      .eq("deal_id", dealId)
      .eq("included_in_global", true)
      .eq("is_being_refinanced", false);

    if (exErr) {
      return { ok: false, error: `existing_debt query: ${exErr.message}` };
    }

    let existing: number | null = null;
    if (existingRows && existingRows.length > 0) {
      existing = 0;
      for (const row of existingRows) {
        if (row.annual_debt_service != null) {
          existing += Number(row.annual_debt_service);
        } else if (row.monthly_payment != null) {
          existing += Number(row.monthly_payment) * 12;
        }
      }
      if (existing === 0 && existingRows.length > 0) {
        existing = null; // All rows had null payments
      }
    }

    // Step 3: Compute total
    const total =
      proposed != null || existing != null
        ? (proposed ?? 0) + (existing ?? 0)
        : null;

    const asOfDate = new Date().toISOString().slice(0, 10);

    // Step 4: Write 3 facts
    const factWrites: Promise<{ ok: boolean; error?: string }>[] = [];

    if (proposed != null) {
      factWrites.push(
        upsertDealFinancialFact({
          dealId,
          bankId,
          sourceDocumentId: SENTINEL_UUID,
          factType: "FINANCIAL_ANALYSIS",
          factKey: "ANNUAL_DEBT_SERVICE_PROPOSED",
          factValueNum: proposed,
          confidence: 0.9,
          provenance: {
            source_type: "STRUCTURAL",
            source_ref: `deal_structural_pricing:${dealId}`,
            as_of_date: asOfDate,
          },
          ownerType: "DEAL",
          ownerEntityId: SENTINEL_UUID,
        }),
      );
    }

    if (existing != null) {
      factWrites.push(
        upsertDealFinancialFact({
          dealId,
          bankId,
          sourceDocumentId: SENTINEL_UUID,
          factType: "FINANCIAL_ANALYSIS",
          factKey: "ANNUAL_DEBT_SERVICE_EXISTING",
          factValueNum: existing,
          confidence: 0.9,
          provenance: {
            source_type: "STRUCTURAL",
            source_ref: `deal_existing_debt:${dealId}`,
            as_of_date: asOfDate,
          },
          ownerType: "DEAL",
          ownerEntityId: SENTINEL_UUID,
        }),
      );
    }

    if (total != null) {
      factWrites.push(
        upsertDealFinancialFact({
          dealId,
          bankId,
          sourceDocumentId: SENTINEL_UUID,
          factType: "FINANCIAL_ANALYSIS",
          factKey: "ANNUAL_DEBT_SERVICE",
          factValueNum: total,
          confidence: 0.9,
          provenance: {
            source_type: "STRUCTURAL",
            source_ref: `total_debt:${dealId}`,
            as_of_date: asOfDate,
          },
          ownerType: "DEAL",
          ownerEntityId: SENTINEL_UUID,
        }),
      );
    }

    await Promise.all(factWrites);

    // Step 5: If NOI available, compute and write DSCR
    let dscr: number | null = null;
    let gcf_dscr: number | null = null;

    if (total != null && total > 0) {
      const { data: noiFact } = await (sb as any)
        .from("deal_financial_facts")
        .select("fact_value_num")
        .eq("deal_id", dealId)
        .eq("fact_key", "CASH_FLOW_AVAILABLE")
        .order("confidence", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (noiFact?.fact_value_num != null) {
        dscr = Number(noiFact.fact_value_num) / total;
        factWrites.length = 0; // reuse array

        await upsertDealFinancialFact({
          dealId,
          bankId,
          sourceDocumentId: SENTINEL_UUID,
          factType: "FINANCIAL_ANALYSIS",
          factKey: "DSCR",
          factValueNum: Math.round(dscr * 1000) / 1000,
          confidence: 0.9,
          provenance: {
            source_type: "STRUCTURAL",
            source_ref: `computed:noi/total_debt`,
            as_of_date: asOfDate,
            calc: `${noiFact.fact_value_num} / ${total}`,
          },
          ownerType: "DEAL",
          ownerEntityId: SENTINEL_UUID,
        });
      }

      // Step 6: If GCF available, compute and write GCF_DSCR
      const { data: gcfFact } = await (sb as any)
        .from("deal_financial_facts")
        .select("fact_value_num")
        .eq("deal_id", dealId)
        .eq("fact_key", "GCF_GLOBAL_CASH_FLOW")
        .order("confidence", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (gcfFact?.fact_value_num != null) {
        gcf_dscr = Number(gcfFact.fact_value_num) / total;

        await upsertDealFinancialFact({
          dealId,
          bankId,
          sourceDocumentId: SENTINEL_UUID,
          factType: "FINANCIAL_ANALYSIS",
          factKey: "GCF_DSCR",
          factValueNum: Math.round(gcf_dscr * 1000) / 1000,
          confidence: 0.9,
          provenance: {
            source_type: "STRUCTURAL",
            source_ref: `computed:gcf/total_debt`,
            as_of_date: asOfDate,
            calc: `${gcfFact.fact_value_num} / ${total}`,
          },
          ownerType: "DEAL",
          ownerEntityId: SENTINEL_UUID,
        });
      }
    }

    return {
      ok: true,
      data: { proposed, existing, total, dscr, gcf_dscr },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
