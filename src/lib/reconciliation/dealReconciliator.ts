import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import type { IndustryProfile } from "@/lib/industryIntelligence/types";
import type { ReconciliationCheck, DealReconciliationSummary } from "./types";
import { checkK1ToEntity } from "./k1ToEntityCheck";
import { checkBalanceSheet } from "./balanceSheetCheck";
import { checkMultiYearTrend } from "./multiYearTrendCheck";
import { checkOwnershipIntegrity, normalizeOwnershipFraction } from "./ownershipIntegrityCheck";
import { selectK1CheckInputs } from "./selectK1CheckInputs";

type FactRow = {
  fact_key: string;
  fact_value_num: number | null;
  source_document_id: string | null;
  fact_period_start: string | null;
  fact_period_end: string | null;
  fact_type?: string | null;
  owner_type?: string | null;
};

/**
 * Rank a fact row for the cross-document checks: entity-level (DEAL) facts
 * beat guarantor (PERSONAL) facts, and for K-1 keys the K-1 emitted by the
 * BUSINESS return (TAX_RETURN_K1) beats a Schedule E line on a 1040. Without
 * this, K1_TO_ENTITY compared entity OBI against a PERSONAL K1_ORDINARY_INCOME
 * and reported a hard conflict on every sole-owner S-corp.
 */
function factRowRank(r: FactRow): number {
  let rank = 0;
  if ((r.owner_type ?? "DEAL") !== "DEAL") rank += 10;
  if (r.fact_key.startsWith("K1_") && r.fact_type !== "TAX_RETURN_K1") rank += 1;
  return rank;
}

function buildFactMap(rows: FactRow[]): Record<string, number | null> {
  const map: Record<string, number | null> = {};
  const ordered = [...rows].sort((a, b) => factRowRank(a) - factRowRank(b));
  for (const r of ordered) {
    if (r.fact_key in map) continue; // first (best-ranked) wins
    map[r.fact_key] = r.fact_value_num;
  }
  return map;
}

function buildSummary(
  dealId: string,
  checks: ReconciliationCheck[],
): DealReconciliationSummary {
  const passed = checks.filter((c) => c.status === "PASSED");
  const failed = checks.filter((c) => c.status === "FAILED");
  const skipped = checks.filter((c) => c.status === "SKIPPED");

  const hardFailures = failed.filter((c) => c.severity === "HARD");
  const softFlags = failed.filter((c) => c.severity === "SOFT");

  let overallStatus: "CLEAN" | "FLAGS" | "CONFLICTS";
  if (hardFailures.length > 0) {
    overallStatus = "CONFLICTS";
  } else if (softFlags.length > 0) {
    overallStatus = "FLAGS";
  } else {
    overallStatus = "CLEAN";
  }

  return {
    dealId,
    checksRun: checks.length,
    checksPassed: passed.length,
    checksFailed: failed.length,
    checksSkipped: skipped.length,
    hardFailures,
    softFlags,
    overallStatus,
    reconciledAt: new Date().toISOString(),
  };
}

/**
 * Run all applicable cross-document reconciliation checks for a deal.
 *
 * Loads facts from DB, runs checks based on available data, persists summary.
 * CRITICAL: Never throws — full try/catch.
 */
export async function reconcileDeal(
  dealId: string,
  industryProfile?: IndustryProfile | null,
): Promise<DealReconciliationSummary> {
  try {
    const sb = supabaseAdmin();

    // 1. Load all facts for the deal
    // Active truth only: superseded / rejected rows are stale extractions and
    // must not feed the cross-document checks.
    const { data: factRows, error: factsError } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, source_document_id, fact_period_start, fact_period_end, fact_type, owner_type")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected");

    if (factsError || !factRows || factRows.length === 0) {
      const emptySummary = buildSummary(dealId, []);
      return emptySummary;
    }

    const allFacts = buildFactMap(factRows as FactRow[]);
    const checks: ReconciliationCheck[] = [];

    // 2. Group facts by period for multi-year analysis
    const periodFacts = new Map<string, Record<string, number | null>>();
    const rankedRows = [...(factRows as FactRow[])].sort((a, b) => factRowRank(a) - factRowRank(b));
    for (const row of rankedRows) {
      const year = row.fact_period_end?.slice(0, 4) ?? "unknown";
      if (!periodFacts.has(year)) periodFacts.set(year, {});
      const m = periodFacts.get(year)!;
      if (row.fact_key in m) continue; // first (best-ranked) wins
      m[row.fact_key] = row.fact_value_num;
    }

    // 3. K1_TO_ENTITY — check if we have OBI and K1 facts
    // Compare within one tax year: the flat map mixes years (entity OBI from
    // the 2025 return against the 2024 K-1 reported a 45,259 "hard conflict").
    const k1Inputs = selectK1CheckInputs(periodFacts, allFacts);
    const entityObi = k1Inputs.entityObi;
    const k1Income = k1Inputs.k1Income;
    // K1_OWNERSHIP_PCT is extracted on the percent scale (100 = sole owner);
    // every check below reasons in fractions.
    const k1Pct = normalizeOwnershipFraction(k1Inputs.k1Pct);

    if (entityObi !== null && (k1Income !== null || k1Pct !== null)) {
      const k1Allocations = [];
      if (k1Income !== null) {
        k1Allocations.push({
          partnerName: "Partner 1",
          ordinaryIncome: k1Income,
          ownershipPct: k1Pct,
        });
      }
      checks.push(checkK1ToEntity({ entityObi, k1Allocations }));
    }

    // 4. BALANCE_SHEET
    // Canonical keys first, then SL_ (Schedule L) prefixed aliases from tax return extraction
    const totalAssets = allFacts["TOTAL_ASSETS"] ?? allFacts["SL_TOTAL_ASSETS"] ?? null;
    const totalLiabilities = allFacts["TOTAL_LIABILITIES"] ?? allFacts["SL_TOTAL_LIABILITIES"] ?? null;
    // NET_WORTH is the canonical key; TOTAL_EQUITY and SL_TOTAL_EQUITY are aliases
    const totalEquity = allFacts["NET_WORTH"] ?? allFacts["TOTAL_EQUITY"] ?? allFacts["SL_TOTAL_EQUITY"] ?? null;

    if (totalAssets !== null || totalLiabilities !== null || totalEquity !== null) {
      checks.push(
        checkBalanceSheet({
          totalAssets,
          totalLiabilities,
          totalEquity,
          sourceName: "Deal Financial Facts",
        }),
      );
    }

    // 5. MULTI_YEAR_TREND — find two consecutive years
    const years = [...periodFacts.keys()]
      .filter((y) => y !== "unknown")
      .sort();

    if (years.length >= 2) {
      const priorYear = parseInt(years[years.length - 2], 10);
      const currentYear = parseInt(years[years.length - 1], 10);
      const priorFacts = periodFacts.get(years[years.length - 2])!;
      const currentFacts = periodFacts.get(years[years.length - 1])!;

      checks.push(
        checkMultiYearTrend({
          currentRevenue: currentFacts["GROSS_RECEIPTS"] ?? null,
          priorRevenue: priorFacts["GROSS_RECEIPTS"] ?? null,
          currentYear,
          priorYear,
          industryProfile,
        }),
      );
    }

    // 6. OWNERSHIP_INTEGRITY — if K-1 ownership data present
    if (k1Pct !== null) {
      checks.push(
        checkOwnershipIntegrity({
          k1Allocations: [{ partnerName: "Partner 1", ownershipPct: k1Pct }],
        }),
      );
    }

    // 7. Build summary
    const summary = buildSummary(dealId, checks);

    // 8. Persist to deal_reconciliation_results
    try {
      await (sb as any)
        .from("deal_reconciliation_results")
        .upsert(
          {
            deal_id: dealId,
            checks_run: summary.checksRun,
            checks_passed: summary.checksPassed,
            checks_failed: summary.checksFailed,
            checks_skipped: summary.checksSkipped,
            hard_failures: summary.hardFailures,
            soft_flags: summary.softFlags,
            overall_status: summary.overallStatus,
            reconciled_at: summary.reconciledAt,
          },
          { onConflict: "deal_id" },
        );
    } catch (err) {
      console.error("[dealReconciliator] persist failed", { dealId, err });
    }

    // 9. Ledger event
    writeEvent({
      dealId,
      kind: "deal.reconciliation_complete",
      scope: "reconciliation",
      action: "reconciliation_complete",
      meta: {
        checks_run: summary.checksRun,
        checks_passed: summary.checksPassed,
        checks_failed: summary.checksFailed,
        overall_status: summary.overallStatus,
      },
    }).catch(() => {});

    // 10. Aegis findings for failures
    if (summary.hardFailures.length > 0) {
      (sb as any)
        .from("buddy_system_events")
        .insert({
          deal_id: dealId,
          event_type: "error",
          severity: "HIGH",
          error_class: "RECONCILIATION",
          error_code: "CROSS_DOC_CONFLICT",
          error_signature: `reconciliation_conflicts_${dealId}`,
          error_message: `${summary.hardFailures.length} cross-document conflict(s) detected.`,
          source_system: "deal_reconciliator",
          resolution_status: "open",
          payload: { hard_failures: summary.hardFailures },
        })
        .then(() => {})
        .catch(() => {});
    } else if (summary.softFlags.length > 0) {
      (sb as any)
        .from("buddy_system_events")
        .insert({
          deal_id: dealId,
          event_type: "warning",
          severity: "LOW",
          error_class: "RECONCILIATION",
          error_code: "CROSS_DOC_FLAGS",
          error_signature: `reconciliation_flags_${dealId}`,
          error_message: `${summary.softFlags.length} cross-document flag(s) detected.`,
          source_system: "deal_reconciliator",
          resolution_status: "open",
          payload: { soft_flags: summary.softFlags },
        })
        .then(() => {})
        .catch(() => {});
    }

    return summary;
  } catch (err) {
    console.error("[dealReconciliator] reconcileDeal catch", { dealId, err });
    return buildSummary(dealId, []);
  }
}
