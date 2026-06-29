import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { composeSpreadOutput } from "@/lib/spreadOutput/spreadOutputComposer";
import { buildCanonicalFactsFromRows, type CanonicalFactRow } from "@/lib/spreadOutput/canonicalFacts";
import { detectDealType } from "@/lib/spreadOutput/dealTypeDetection";
import { composeFlagReport } from "@/lib/flagEngine/flagComposer";
import { computeAuthoritativeEngine } from "@/lib/modelEngine/engineAuthority";
import type { SpreadOutputInput, DealType } from "@/lib/spreadOutput/types";
import type { FlagEngineInput } from "@/lib/flagEngine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function toNumSafe(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

type Ctx = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// GET — Generate spread output report
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const sb = supabaseAdmin();

    // --- PRICING GATE ---
    const { data: pricingRow, error: pricingErr } = await (sb as any)
      .from("deal_structural_pricing")
      .select("id, annual_debt_service_est")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pricingErr) {
      console.error("[spread-output] pricing check error", pricingErr.message);
    }

    if (!pricingRow || pricingRow.annual_debt_service_est == null) {
      // Fallback: if deal_pricing_inputs exists, proceed without ADS
      // (DSCR shows as "—" until structural pricing is seeded)
      const { data: inputsCheck } = await sb
        .from("deal_pricing_inputs")
        .select("deal_id")
        .eq("deal_id", dealId)
        .maybeSingle();

      if (!inputsCheck) {
        return NextResponse.json(
          {
            ok: false,
            error: "pricing_assumptions_required",
            message:
              "Pricing assumptions must be saved before spreads can be generated. Set pricing on the Pricing tab first.",
          },
          { status: 422 },
        );
      }
      // Has pricing inputs — proceed; ADS injection skipped, DSCR will be "—"
    }
    // --- END PRICING GATE ---

    // Build SpreadOutputInput from DB + V2 engine — parallel queries
    const [factsResult, authResult, dealResult, qoeResult, trendResult] =
      await Promise.all([
        loadCanonicalFacts(sb, dealId),
        computeAuthoritativeEngine(dealId, access.bankId).catch((err: unknown) => {
          console.warn("[spread-output] V2 engine failed (non-fatal)",
            err instanceof Error ? err.message : String(err));
          return null;
        }),
        loadDealMeta(sb, dealId),
        loadQoEReport(sb, dealId),
        loadTrendReport(sb, dealId),
      ]);

    // SPEC-SPREAD-SOURCE-OF-TRUTH-UNIFICATION-1: do NOT inject the proposed-loan
    // annual_debt_service_est into every historical year — that made each year's DSCR
    // a proposed-loan-coverage figure masquerading as historical debt-service coverage.
    // Historical debt service must come from actual statement facts
    // (cf_annual_debt_service_{year}); the canonical/authoritative DSCR (computeTotalDebtService
    // → snapshot, read below) governs the deal-level ratio. (Defect removed; pricingRow
    // retained for the pricing gate above.)

    // --- Ratios: derived inline as safety net, V2 authoritative wins ---
    const derivedRatios = deriveInlineRatios(factsResult.facts, factsResult.years);
    const ratiosResult: Record<string, number | null> = { ...derivedRatios };

    // Fallback: if inline DSCR is null/0, read from latest financial snapshot
    // (aggregator writes DSCR to deal_financial_facts, snapshot builder picks it up)
    if (ratiosResult["ratio_dscr_final"] == null || ratiosResult["ratio_dscr_final"] === 0) {
      try {
        const { data: snapRow } = await sb
          .from("financial_snapshots")
          .select("snapshot_json")
          .eq("deal_id", dealId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const snapDscr = (snapRow as any)?.snapshot_json?.dscr?.value_num;
        if (typeof snapDscr === "number" && snapDscr > 0) {
          ratiosResult["DSCR"] = snapDscr;
          ratiosResult["ratio_dscr_final"] = snapDscr;
        }
      } catch {
        // Non-fatal — inline DSCR stays null
      }
    }

    if (authResult) {
      for (const [k, v] of Object.entries(authResult.computedMetrics)) {
        if (v !== null) ratiosResult[k] = v;
      }
    }
    // Inject per-year DSCR back into facts so the template can render it
    for (const year of factsResult.years) {
      const dscrVal = toNumSafe(derivedRatios[`DSCR_${year}`]);
      if (dscrVal !== null && (factsResult.facts as Record<string, unknown>)[`DSCR_${year}`] == null) {
        (factsResult.facts as Record<string, unknown>)[`DSCR_${year}`] = dscrVal;
      }
    }

    // --- Fix B: Merge borrower context into canonical facts ---
    if (dealResult.meta_facts) {
      for (const [key, val] of Object.entries(dealResult.meta_facts)) {
        if (val != null && (factsResult.facts as Record<string, unknown>)[key] == null) {
          (factsResult.facts as Record<string, unknown>)[key] = val;
        }
      }
    }

    // --- Fix C: Derive inline trend report if DB is empty ---
    let resolvedTrendReport = trendResult;
    if (!resolvedTrendReport && factsResult.years.length >= 2) {
      resolvedTrendReport = deriveInlineTrend(factsResult.facts, factsResult.years);
    }

    // Detect deal type
    const dealType: DealType =
      (dealResult.entity_type as DealType) ??
      detectDealType(factsResult.facts);

    // Build flag report from already-loaded facts + ratios (no duplicate DB call)
    const flagInput: FlagEngineInput | null =
      Object.keys(factsResult.facts).length > 0
        ? { deal_id: dealId, canonical_facts: factsResult.facts, ratios: ratiosResult, years_available: factsResult.years }
        : null;
    const flagReport = flagInput
      ? composeFlagReport(flagInput)
      : undefined;

    const input: SpreadOutputInput = {
      deal_id: dealId,
      deal_type: dealType,
      canonical_facts: factsResult.facts,
      ratios: ratiosResult,
      years_available: factsResult.years,
      qoe_report: qoeResult ?? undefined,
      trend_report: resolvedTrendReport ?? undefined,
      flag_report: flagReport,
    };

    const report = composeSpreadOutput(input);

    // ── Ensure canonical financial_snapshots row exists ──────────
    // Without this, /pricing blocks on financialSnapshotExists even though
    // /spreads renders a complete report. fire-and-forget: response is not
    // delayed, but snapshot persistence failure is surfaced as a warning.
    let snapshotWarning: string | null = null;
    try {
      const { buildDealFinancialSnapshotForBank, persistCashFlowAvailableFromSnapshot } =
        await import("@/lib/deals/financialSnapshot");
      const { persistFinancialSnapshot } =
        await import("@/lib/deals/financialSnapshotPersistence");

      const snapshot = await buildDealFinancialSnapshotForBank({
        dealId,
        bankId: access.bankId,
      });
      await persistCashFlowAvailableFromSnapshot({
        dealId,
        bankId: access.bankId,
        snapshot,
      });
      await persistFinancialSnapshot({
        dealId,
        bankId: access.bankId,
        snapshot,
      });
    } catch (snapErr: unknown) {
      const msg = snapErr instanceof Error ? snapErr.message : String(snapErr);
      // Hash-duplicate inserts (same snapshot already persisted) are expected — not a real error
      if (!msg.includes("duplicate") && !msg.includes("snapshot_hash")) {
        console.warn("[spread-output] snapshot persistence failed (non-fatal):", msg);
        snapshotWarning = `Spread report generated but financial snapshot could not be persisted: ${msg}`;
      }
    }

    // Pass through canonical_facts, ratios, years, flags, and
    // map story_panel → narrative_report so IntelligenceClient can read them.
    return NextResponse.json({
      ok: true,
      ...(snapshotWarning ? { snapshotWarning } : {}),
      report: {
        ...report,
        canonical_facts: input.canonical_facts,
        ratios: ratiosResult,
        years_available: input.years_available,
        flag_report: input.flag_report,
        trend_report: resolvedTrendReport ?? undefined,
        narrative_report: report.story_panel
          ? {
              final_narrative: report.story_panel.final_narrative,
              resolution_narrative: report.story_panel.resolution_narrative,
              top_risks: report.story_panel.top_risks,
              top_strengths: report.story_panel.top_strengths,
              ratio_narratives: {},
            }
          : undefined,
      },
    });
  } catch (err: unknown) {
    rethrowNextErrors(err);
    console.error("[spread-output] GET error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DB loaders
// ---------------------------------------------------------------------------

async function loadCanonicalFacts(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<{ facts: Record<string, unknown>; years: number[] }> {
  try {
    // SPEC-SPREAD-ENTITY-SCOPING-1: select source_canonical_type (needed for the
    // entity source guard) and order deterministically so business-source
    // collisions resolve identically every run.
    const { data, error } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, fact_value_text, fact_period_end, source_canonical_type")
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .order("fact_period_end", { ascending: true })
      .order("source_canonical_type", { ascending: true })
      .order("fact_key", { ascending: true });

    if (error || !data) return { facts: {}, years: [] };

    return buildCanonicalFactsFromRows(data as CanonicalFactRow[]);
  } catch {
    return { facts: {}, years: [] };
  }
}

async function loadDealMeta(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<{ entity_type: string | null; meta_facts: Record<string, unknown> | null }> {
  try {
    const { data: deal } = await (sb as any)
      .from("deals")
      .select("entity_type, borrower_id, loan_amount")
      .eq("id", dealId)
      .maybeSingle();

    const meta: Record<string, unknown> = {};
    const entityType = deal?.entity_type ?? null;

    if (deal?.loan_amount != null) {
      meta["loan_amount"] = Number(deal.loan_amount);
    }

    // Join borrower for entity_name + NAICS
    if (deal?.borrower_id) {
      const { data: borrower } = await (sb as any)
        .from("borrowers")
        .select("legal_name, naics_code, entity_type")
        .eq("id", deal.borrower_id)
        .maybeSingle();

      if (borrower) {
        if (borrower.legal_name) meta["entity_name"] = borrower.legal_name;
        if (borrower.naics_code) meta["naics_code"] = borrower.naics_code;
        // Borrower entity_type as fallback if deal doesn't have one
        if (!entityType && borrower.entity_type) {
          meta["entity_type"] = borrower.entity_type;
        }
      }
    }

    // Loan purpose from deal_loan_requests
    const { data: loanReq } = await (sb as any)
      .from("deal_loan_requests")
      .select("loan_purpose, purpose, requested_amount")
      .eq("deal_id", dealId)
      .order("request_number", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (loanReq) {
      const purpose = loanReq.loan_purpose ?? loanReq.purpose;
      if (purpose) meta["loan_purpose"] = purpose;
      if (loanReq.requested_amount != null && meta["loan_amount"] == null) {
        meta["loan_amount"] = Number(loanReq.requested_amount);
      }
    }

    return {
      entity_type: entityType,
      meta_facts: Object.keys(meta).length > 0 ? meta : null,
    };
  } catch {
    return { entity_type: null, meta_facts: null };
  }
}

async function loadQoEReport(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<any | null> {
  try {
    const { data } = await (sb as any)
      .from("deal_qoe_reports")
      .select("report_json")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return data?.report_json ?? null;
  } catch {
    return null;
  }
}

async function loadTrendReport(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<any | null> {
  try {
    const { data } = await (sb as any)
      .from("deal_trend_analyses")
      .select("analysis_json")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    return data?.analysis_json ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fix A: Derive key ratios inline from year-keyed facts
// ---------------------------------------------------------------------------

function deriveInlineRatios(
  facts: Record<string, unknown>,
  years: number[],
): Record<string, number | null> {
  const ratios: Record<string, number | null> = {};

  for (const year of years) {
    const ebitda = toNumSafe(facts[`EBITDA_${year}`]);
    const revenue = toNumSafe(facts[`GROSS_RECEIPTS_${year}`]);
    const grossProfit = toNumSafe(facts[`GROSS_PROFIT_${year}`]);
    const ads = toNumSafe(facts[`cf_annual_debt_service_${year}`]);
    const interestExpense = toNumSafe(facts[`INTEREST_EXPENSE_${year}`]);

    // DSCR = EBITDA / ADS (or cf_ncads / ADS)
    if (ads !== null && ads > 0) {
      const ncads = toNumSafe(facts[`cf_ncads_${year}`]) ?? ebitda;
      if (ncads !== null) {
        const dscr = Math.round((ncads / ads) * 100) / 100;
        ratios[`DSCR_${year}`] = dscr;
        // Also set the latest year as the headline DSCR
        ratios["DSCR"] = dscr;
        ratios["ratio_dscr_final"] = dscr;
      }
    }

    // EBITDA Margin = EBITDA / Revenue
    if (ebitda !== null && revenue !== null && revenue > 0) {
      const margin = Math.round((ebitda / revenue) * 10000) / 10000;
      ratios[`EBITDA_MARGIN_${year}`] = margin;
      ratios["EBITDA_MARGIN"] = margin;
      ratios["ratio_ebitda_margin_pct"] = margin;
    }

    // Gross Margin = Gross Profit / Revenue
    if (grossProfit !== null && revenue !== null && revenue > 0) {
      const gm = Math.round((grossProfit / revenue) * 10000) / 10000;
      ratios[`GROSS_MARGIN_${year}`] = gm;
      ratios["GROSS_MARGIN"] = gm;
      ratios["ratio_gross_margin_pct"] = gm;
    }

    // Interest Coverage = EBITDA / Interest Expense
    if (ebitda !== null && interestExpense !== null && interestExpense > 0) {
      const ic = Math.round((ebitda / interestExpense) * 100) / 100;
      ratios[`INTEREST_COVERAGE_${year}`] = ic;
      ratios["INTEREST_COVERAGE"] = ic;
    }
  }

  return ratios;
}

// ---------------------------------------------------------------------------
// Fix C: Derive inline trend report from year-keyed facts
// ---------------------------------------------------------------------------

type TrendSeries = {
  direction: "POSITIVE" | "DECLINING" | "STABLE" | "COMPRESSING";
  values: (number | null)[];
  first_year: number;
  last_year: number;
  change_pct: number;
};

function buildTrendSeries(
  facts: Record<string, unknown>,
  sortedYears: number[],
  factKey: string,
  higherIsBetter: boolean = true,
): TrendSeries | null {
  const values: (number | null)[] = sortedYears.map((y) => toNumSafe(facts[`${factKey}_${y}`]));
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length < 2) return null;
  const first = nonNull[0];
  const last = nonNull[nonNull.length - 1];
  const changePct = first !== 0 ? Math.round(((last - first) / Math.abs(first)) * 10000) / 10000 : 0;
  let direction: TrendSeries["direction"];
  if (Math.abs(changePct) < 0.02) direction = "STABLE";
  else direction = (changePct > 0) === higherIsBetter ? "POSITIVE" : "DECLINING";
  return { direction, values, first_year: sortedYears[0], last_year: sortedYears[sortedYears.length - 1], change_pct: changePct };
}

function deriveInlineTrend(
  facts: Record<string, unknown>,
  years: number[],
): Record<string, unknown> | null {
  if (years.length < 2) return null;
  const sorted = [...years].sort((a, b) => a - b);
  const trendRevenue  = buildTrendSeries(facts, sorted, "GROSS_RECEIPTS", true);
  const trendEbitda   = buildTrendSeries(facts, sorted, "EBITDA", true);
  const trendGrossRaw = buildTrendSeries(facts, sorted, "GROSS_PROFIT", true);
  const trendDscr     = buildTrendSeries(facts, sorted, "DSCR", true);
  // Label gross margin compression explicitly for narrativeComposer trigger
  const trendGrossMargin = trendGrossRaw
    ? { ...trendGrossRaw, direction: trendGrossRaw.direction === "DECLINING" ? ("COMPRESSING" as const) : trendGrossRaw.direction }
    : null;
  if (!trendRevenue && !trendEbitda) return null;
  return {
    source: "inline_derived",
    period: { first_year: sorted[0], last_year: sorted[sorted.length - 1] },
    trendRevenue:     trendRevenue     ?? undefined,
    trendGrossMargin: trendGrossMargin ?? undefined,
    trendEbitda:      trendEbitda      ?? undefined,
    trendDscr:        trendDscr        ?? undefined,
  };
}
