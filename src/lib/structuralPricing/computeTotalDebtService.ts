import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealFinancialFact, SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { computeDebtService } from "./debtServiceMath";
import { assessDenominatorCompleteness } from "./debtServiceCompleteness";

export type TotalDebtServiceResult = {
  proposed: number | null;
  existing: number | null;
  total: number | null;
  dscr: number | null;
  gcf_dscr: number | null;
  dscr_stressed_300bps: number | null;
  /** SPEC-GLOBAL-DEBT-SERVICE-DENOMINATOR-1: denominator completeness labeling. */
  existingDebtOnFile: boolean;
  globalDscrPreliminary: boolean;
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
  /** When true, skip existing debt schedule query and treat existing debt as 0. */
  skipExistingDebt?: boolean;
}): Promise<{ ok: true; data: TotalDebtServiceResult } | { ok: false; error: string }> {
  const { dealId, bankId, skipExistingDebt } = args;

  try {
    const sb = supabaseAdmin();

    // Step 1: Get latest proposed ADS from structural pricing
    const { data: spRow, error: spErr } = await (sb as any)
      .from("deal_structural_pricing")
      .select("annual_debt_service_est, structural_rate_pct, loan_amount, amort_months, interest_only_months")
      .eq("deal_id", dealId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (spErr) {
      return { ok: false, error: `structural_pricing query: ${spErr.message}` };
    }

    const proposed: number | null = spRow?.annual_debt_service_est ?? null;

    // Step 2: Sum existing debt (included_in_global = true, not being refinanced)
    let existing: number | null = null;
    let existingDebtRowsPresent = false;

    if (skipExistingDebt) {
      existing = 0;
    } else {
      const { data: existingRows, error: exErr } = await (sb as any)
        .from("deal_existing_debt_schedule")
        .select("annual_debt_service, monthly_payment")
        .eq("deal_id", dealId)
        .eq("included_in_global", true)
        .eq("is_being_refinanced", false);

      if (exErr) {
        return { ok: false, error: `existing_debt query: ${exErr.message}` };
      }

      existingDebtRowsPresent = !!(existingRows && existingRows.length > 0);
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
    }

    // Step 3: Compute total
    const total =
      proposed != null || existing != null
        ? (proposed ?? 0) + (existing ?? 0)
        : null;

    const asOfDate = new Date().toISOString().slice(0, 10);

    // SPEC-GLOBAL-DEBT-SERVICE-DENOMINATOR-1: assess denominator completeness.
    // Guarantor/personal obligations are confirmed if we have either a PFS personal
    // debt-service fact or any guarantor-cashflow row on file. Otherwise the GLOBAL
    // DSCR is labeled preliminary (business DSCR is still shown as-is).
    let guarantorObligationsConfirmed = false;
    if (!skipExistingDebt) {
      const [{ data: pfsDebt }, { data: guarRows }] = await Promise.all([
        (sb as any)
          .from("deal_financial_facts")
          .select("fact_value_num")
          .eq("deal_id", dealId)
          .eq("fact_key", "PFS_ANNUAL_DEBT_SERVICE")
          .eq("is_superseded", false)
          .neq("resolution_status", "rejected")
          .not("fact_value_num", "is", null)
          .limit(1),
        (sb as any)
          .from("buddy_guarantor_cashflow")
          .select("id")
          .eq("deal_id", dealId)
          .limit(1),
      ]);
      guarantorObligationsConfirmed =
        (Array.isArray(pfsDebt) && pfsDebt.length > 0) ||
        (Array.isArray(guarRows) && guarRows.length > 0);
    }
    const completeness = assessDenominatorCompleteness({
      existingDebtRowsPresent,
      guarantorObligationsConfirmed,
    });

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
            extractor: "computeTotalDebtService:v1",
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
            extractor: "computeTotalDebtService:v1",
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
            extractor: "computeTotalDebtService:v1",
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
    let dscr_stressed_300bps: number | null = null;

    if (total != null && total > 0) {
      const { data: noiFact } = await (sb as any)
        .from("deal_financial_facts")
        .select("fact_value_num")
        .eq("deal_id", dealId)
        .eq("fact_key", "CASH_FLOW_AVAILABLE")
        .eq("is_superseded", false)
        .neq("resolution_status", "rejected")
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
            extractor: "computeTotalDebtService:v1",
            calc: `${noiFact.fact_value_num} / ${total}`,
            // SPEC-GLOBAL-DEBT-SERVICE-DENOMINATOR-1: this is BUSINESS DSCR over the
            // total business denominator (proposed + on-file existing), not proposed-only.
            denominator: "total_business_ads",
            denominator_basis: { proposed, existing: existing ?? 0 },
            existing_debt_on_file: completeness.existingDebtOnFile,
            note: completeness.businessNote,
          },
          ownerType: "DEAL",
          ownerEntityId: SENTINEL_UUID,
        });
      } else {
        // SPEC-FOUNDATION-V1 PR5a — graceful degradation: CASH_FLOW_AVAILABLE
        // fact is null even after the aggregator ran (PR5a inserted it before
        // this function in the spreadsProcessor chain). ADS facts were still
        // written above; DSCR is skipped. Emit a warning event so operators
        // can diagnose why the prerequisite was missing.
        console.warn("[computeTotalDebtService] MISSING_PREREQ_NOI: CASH_FLOW_AVAILABLE fact is null, skipping DSCR computation", {
          dealId,
          totalAds: total,
        });
        void writeEvent({
          dealId,
          kind: "deal.compute.missing_prereq",
          meta: {
            error_code: "MISSING_PREREQ_NOI",
            severity: "warning",
            detail: "CASH_FLOW_AVAILABLE fact is null after aggregator ran; DSCR skipped. ADS facts written.",
            total_ads: total,
          },
        }).catch(() => {});
      }

      // Step 6: If GCF available, compute and write GCF_DSCR
      const { data: gcfFact } = await (sb as any)
        .from("deal_financial_facts")
        .select("fact_value_num")
        .eq("deal_id", dealId)
        .eq("fact_key", "GCF_GLOBAL_CASH_FLOW")
        .eq("is_superseded", false)
        .neq("resolution_status", "rejected")
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
            extractor: "computeTotalDebtService:v1",
            calc: `${gcfFact.fact_value_num} / ${total}`,
            // SPEC-GLOBAL-DEBT-SERVICE-DENOMINATOR-1: GLOBAL DSCR is preliminary until
            // guarantor/personal obligations are confirmed.
            preliminary: completeness.globalDscrPreliminary,
            global_obligations_confirmed: guarantorObligationsConfirmed,
            note: completeness.globalNote,
          },
          ownerType: "DEAL",
          ownerEntityId: SENTINEL_UUID,
        });
      }

      // Step 7: Stressed DSCR at +300bps
      const structRate = spRow?.structural_rate_pct != null ? Number(spRow.structural_rate_pct) : null;
      const loanAmt = spRow?.loan_amount != null ? Number(spRow.loan_amount) : null;
      const amortMo = spRow?.amort_months != null ? Number(spRow.amort_months) : null;
      const ioMo = spRow?.interest_only_months != null ? Number(spRow.interest_only_months) : 0;

      if (structRate != null && loanAmt != null && amortMo != null && noiFact?.fact_value_num != null) {
        const stressedRate = structRate + 3.0;
        const stressedDs = computeDebtService({
          principal: loanAmt,
          ratePct: stressedRate,
          amortMonths: amortMo,
          interestOnlyMonths: ioMo,
        });

        if (stressedDs.annualDebtService != null && stressedDs.annualDebtService > 0) {
          const stressedAds = stressedDs.annualDebtService + (existing ?? 0);
          dscr_stressed_300bps = Number(noiFact.fact_value_num) / stressedAds;

          await upsertDealFinancialFact({
            dealId,
            bankId,
            sourceDocumentId: SENTINEL_UUID,
            factType: "FINANCIAL_ANALYSIS",
            factKey: "DSCR_STRESSED_300BPS",
            factValueNum: Math.round(dscr_stressed_300bps * 1000) / 1000,
            confidence: 0.9,
            provenance: {
              source_type: "STRUCTURAL",
              source_ref: `computed:noi/stressed_total_debt`,
              as_of_date: asOfDate,
              extractor: "computeTotalDebtService:v1",
              calc: `${noiFact.fact_value_num} / (stressed_proposed=${stressedDs.annualDebtService} + existing=${existing ?? 0}); stressed_rate=${stressedRate}%`,
            },
            ownerType: "DEAL",
            ownerEntityId: SENTINEL_UUID,
          });
        }
      }
    }

    return {
      ok: true,
      data: {
        proposed,
        existing,
        total,
        dscr,
        gcf_dscr,
        dscr_stressed_300bps,
        existingDebtOnFile: completeness.existingDebtOnFile,
        globalDscrPreliminary: completeness.globalDscrPreliminary,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
