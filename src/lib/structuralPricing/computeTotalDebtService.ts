/** @deprecated SPEC-BUDDY-FINENGINE-QUARANTINE-AND-CONNECT-1 — legacy ACTIVE-PRODUCER, quarantined.
 *  Writes ANNUAL_DEBT_SERVICE / DSCR / DSCR_STRESSED_300BPS (computed:noi/total_debt,
 *  total_debt:, deal_structural_pricing:). Do NOT add new importers (enforced by
 *  guard:finengine → guard-finengine-legacy-imports). Migrating to src/lib/finengine/metrics
 *  + debtEngine. Tracked in docs/finengine/LEGACY_IMPORT_INVENTORY.md. No behavior change. */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealFinancialFact, SENTINEL_UUID } from "@/lib/financialFacts/writeFact";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { computeDebtService } from "./debtServiceMath";
import { assessDenominatorCompleteness } from "./debtServiceCompleteness";
import {
  resolveAdsPeriodDate,
  computeAdsTotals,
  summarizeAdsWriteResults,
  staleAdsFactsToSupersede,
  type AdsWriteOutcome,
} from "./computeTotalDebtServiceCore";

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
  /** Valid period/as-of date stamped on every ADS fact written this run. */
  periodDate: string;
  /** Canonical fact keys written (and superseded-of-stale) this run. */
  writtenKeys: string[];
  /** Non-fatal diagnostics (e.g. skipped optional DSCR). */
  diagnostics: string[];
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
 * SPEC-FINANCIAL-ANALYSIS-CANONICAL-ENGINE-AND-ADS-MATERIALIZATION-1:
 *   - Every fact is written with a VALID period/as-of date (latest structural
 *     pricing computed_at, else today) — never the 1900-01-01 sentinel that
 *     upsertDealFinancialFact rejects, so the canonical ADS total actually lands.
 *   - Each upsert result is inspected; a REQUIRED ADS write that is skipped or
 *     fails returns ok:false with an explicit diagnostic (no silent success).
 *   - Stale active same-key DEAL facts (e.g. a 75,000 proposed under a different
 *     period) are superseded so current pricing (101,250) is the only active value.
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
      .select(
        "annual_debt_service_est, structural_rate_pct, loan_amount, amort_months, interest_only_months, computed_at",
      )
      .eq("deal_id", dealId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (spErr) {
      return { ok: false, error: `structural_pricing query: ${spErr.message}` };
    }

    const proposed: number | null = spRow?.annual_debt_service_est ?? null;

    // Step 2: Sum existing debt (included_in_global = true, not being refinanced)
    let existingRows: { annual_debt_service: number | null; monthly_payment: number | null }[] | null = null;

    if (!skipExistingDebt) {
      const { data: rows, error: exErr } = await (sb as any)
        .from("deal_existing_debt_schedule")
        .select("annual_debt_service, monthly_payment")
        .eq("deal_id", dealId)
        .eq("included_in_global", true)
        .eq("is_being_refinanced", false);

      if (exErr) {
        return { ok: false, error: `existing_debt query: ${exErr.message}` };
      }
      existingRows = (rows ?? []) as typeof existingRows;
    }

    // Step 3: Compute proposed / existing / total (pure)
    const totals = computeAdsTotals({ proposed, existingRows, skipExistingDebt });
    const { existing, total, existingDebtRowsPresent } = totals;

    // SPEC-…-ADS-MATERIALIZATION-1: valid period/as-of date — NEVER the sentinel.
    const today = new Date().toISOString().slice(0, 10);
    const periodDate = resolveAdsPeriodDate(spRow?.computed_at, today);
    const asOfDate = periodDate;

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

    // Step 4: Write the ADS facts with a VALID period date and inspect each result.
    const writeOutcomes: AdsWriteOutcome[] = [];
    const writtenKeys: string[] = [];
    const diagnostics: string[] = [];

    const writeAds = async (
      factKey: string,
      factValueNum: number,
      provenance: Record<string, unknown>,
      required: boolean,
    ) => {
      const res = await upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: SENTINEL_UUID,
        factType: "FINANCIAL_ANALYSIS",
        factKey,
        factValueNum,
        confidence: 0.9,
        factPeriodStart: periodDate,
        factPeriodEnd: periodDate,
        provenance: provenance as any,
        ownerType: "DEAL",
        ownerEntityId: SENTINEL_UUID,
      });
      writeOutcomes.push({
        key: factKey,
        ok: res.ok,
        error: res.ok ? undefined : res.error,
        skipped: res.ok ? undefined : (res as { skipped?: boolean }).skipped,
        required,
      });
      if (res.ok) writtenKeys.push(factKey);
    };

    if (totals.proposed != null) {
      await writeAds(
        "ANNUAL_DEBT_SERVICE_PROPOSED",
        totals.proposed,
        {
          source_type: "STRUCTURAL",
          source_ref: `deal_structural_pricing:${dealId}`,
          as_of_date: asOfDate,
          extractor: "computeTotalDebtService:v1",
        },
        true,
      );
    }

    if (existing != null) {
      await writeAds(
        "ANNUAL_DEBT_SERVICE_EXISTING",
        existing,
        {
          source_type: "STRUCTURAL",
          source_ref: `deal_existing_debt:${dealId}`,
          as_of_date: asOfDate,
          extractor: "computeTotalDebtService:v1",
        },
        false,
      );
    }

    if (total != null) {
      await writeAds(
        "ANNUAL_DEBT_SERVICE",
        total,
        {
          source_type: "STRUCTURAL",
          source_ref: `total_debt:${dealId}`,
          as_of_date: asOfDate,
          extractor: "computeTotalDebtService:v1",
        },
        true,
      );
    }

    // SPEC-…-ADS-MATERIALIZATION-1: do not swallow skipped/failed required writes.
    const writeSummary = summarizeAdsWriteResults(writeOutcomes);
    if (!writeSummary.ok) {
      return {
        ok: false,
        error: `ads_write_failed: ${writeSummary.diagnostics.join("; ")}`,
      };
    }

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

        await writeAds(
          "DSCR",
          Math.round(dscr * 1000) / 1000,
          {
            source_type: "STRUCTURAL",
            source_ref: `computed:noi/total_debt`,
            as_of_date: asOfDate,
            extractor: "computeTotalDebtService:v1",
            calc: `${noiFact.fact_value_num} / ${total}`,
            // SPEC-GLOBAL-DEBT-SERVICE-DENOMINATOR-1: this is BUSINESS DSCR over the
            // total business denominator (proposed + on-file existing), not proposed-only.
            denominator: "total_business_ads",
            denominator_basis: { proposed: totals.proposed, existing: existing ?? 0 },
            existing_debt_on_file: completeness.existingDebtOnFile,
            note: completeness.businessNote,
          },
          false,
        );
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
        diagnostics.push("DSCR skipped: CASH_FLOW_AVAILABLE fact is null (MISSING_PREREQ_NOI).");
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

        await writeAds(
          "GCF_DSCR",
          Math.round(gcf_dscr * 1000) / 1000,
          {
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
          false,
        );
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

          await writeAds(
            "DSCR_STRESSED_300BPS",
            Math.round(dscr_stressed_300bps * 1000) / 1000,
            {
              source_type: "STRUCTURAL",
              source_ref: `computed:noi/stressed_total_debt`,
              as_of_date: asOfDate,
              extractor: "computeTotalDebtService:v1",
              calc: `${noiFact.fact_value_num} / (stressed_proposed=${stressedDs.annualDebtService} + existing=${existing ?? 0}); stressed_rate=${stressedRate}%`,
            },
            false,
          );
        }
      }
    }

    // Step 8: Supersede stale active same-key DEAL facts so current pricing is the
    // only active ADS/DSCR value (e.g. a stale 75,000 proposed cannot survive a
    // fresh 101,250). Scoped to the keys we wrote — never touches CASH_FLOW_AVAILABLE,
    // PFS, or unrelated review facts.
    if (writtenKeys.length > 0) {
      const { data: existingAdsFacts } = await (sb as any)
        .from("deal_financial_facts")
        .select("id, fact_key, owner_type, fact_period_end, is_superseded")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .in("fact_key", Array.from(new Set(writtenKeys)))
        .eq("is_superseded", false);

      const staleIds = staleAdsFactsToSupersede({
        existing: (existingAdsFacts ?? []) as any[],
        writtenKeys,
        freshPeriodEnd: periodDate,
      });

      if (staleIds.length > 0) {
        const { error: supErr } = await (sb as any)
          .from("deal_financial_facts")
          .update({ is_superseded: true })
          .in("id", staleIds);
        if (supErr) {
          diagnostics.push(`stale ADS supersession failed: ${supErr.message}`);
        } else {
          diagnostics.push(`Superseded ${staleIds.length} stale ADS/DSCR fact(s) from a prior period.`);
        }
      }
    }

    return {
      ok: true,
      data: {
        proposed: totals.proposed,
        existing,
        total,
        dscr,
        gcf_dscr,
        dscr_stressed_300bps,
        existingDebtOnFile: completeness.existingDebtOnFile,
        globalDscrPreliminary: completeness.globalDscrPreliminary,
        periodDate,
        writtenKeys,
        diagnostics,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
