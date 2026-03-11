import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { composeSpreadOutput } from "@/lib/spreadOutput/spreadOutputComposer";
import { detectDealType } from "@/lib/spreadOutput/dealTypeDetection";
import { composeFlagReport } from "@/lib/flagEngine/flagComposer";
import { computeAuthoritativeEngine } from "@/lib/modelEngine/engineAuthority";
import type { SpreadOutputInput, DealType } from "@/lib/spreadOutput/types";
import type { FlagEngineInput } from "@/lib/flagEngine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
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

    // Inject ADS from pricing into facts for all years
    const annualDebtService = toNumSafe(pricingRow.annual_debt_service_est);
    if (annualDebtService !== null) {
      for (const year of factsResult.years) {
        const adsKey = `cf_annual_debt_service_${year}`;
        if ((factsResult.facts as Record<string, unknown>)[adsKey] == null) {
          (factsResult.facts as Record<string, unknown>)[adsKey] = annualDebtService;
        }
      }
    }

    // --- Ratios: derived inline as safety net, V2 authoritative wins ---
    const derivedRatios = deriveInlineRatios(factsResult.facts, factsResult.years);
    const ratiosResult: Record<string, number | null> = { ...derivedRatios };
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

    return NextResponse.json({ ok: true, report });
  } catch (err: unknown) {
    rethrowNextErrors(err);
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error("[spread-output] GET error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DB loaders
// ---------------------------------------------------------------------------

type FactRow = {
  fact_key: string;
  fact_value_num: number | null;
  fact_value_text: string | null;
  fact_period_end: string | null;
};

async function loadCanonicalFacts(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<{ facts: Record<string, unknown>; years: number[] }> {
  try {
    const { data, error } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, fact_value_text, fact_period_end")
      .eq("deal_id", dealId);

    if (error || !data) return { facts: {}, years: [] };

    const facts: Record<string, unknown> = {};
    const yearsSet = new Set<number>();

    // PFS facts use a statement date (e.g. 2026-01-01), not a fiscal year-end.
    // They must not create spread columns.
    const PFS_KEY_PREFIXES = ["PFS_", "PERSONAL_FINANCIAL_STATEMENT"];

    function toNum(val: unknown): number | null {
      if (val === null || val === undefined) return null;
      const n = Number(val);
      return isFinite(n) ? n : null;
    }

    for (const row of data as FactRow[]) {
      const value = row.fact_value_num ?? row.fact_value_text ?? null;

      if (row.fact_period_end) {
        const year = new Date(row.fact_period_end).getFullYear();
        const isPfsKey = PFS_KEY_PREFIXES.some((p) => row.fact_key.startsWith(p));
        if (!isPfsKey && year >= 2000 && year <= 2100) {
          yearsSet.add(year);
        }
        if (year >= 2000 && year <= 2100) {
          facts[`${row.fact_key}_${year}`] = value;
        }
      }
    }

    // Revenue aliasing: income statements often extract as TOTAL_REVENUE,
    // but the spread template uses GROSS_RECEIPTS. Alias if missing.
    for (const year of Array.from(yearsSet)) {
      const grKey = `GROSS_RECEIPTS_${year}`;
      if (facts[grKey] == null) {
        const alias =
          toNum(facts[`TOTAL_REVENUE_${year}`]) ??
          toNum(facts[`TOTAL_INCOME_${year}`]);
        if (alias !== null) facts[grKey] = alias;
      }
    }

    // COGS aliasing: extractor writes COST_OF_GOODS_SOLD; template uses COGS
    for (const year of Array.from(yearsSet)) {
      const cogsKey = `COGS_${year}`;
      if (facts[cogsKey] == null) {
        const alias = toNum(facts[`COST_OF_GOODS_SOLD_${year}`]);
        if (alias !== null) facts[cogsKey] = alias;
      }
    }

    // Taxes aliasing: template uses TAXES; extractors write TAX_LIABILITY or TAXES_LICENSES
    for (const year of Array.from(yearsSet)) {
      const taxKey = `TAXES_${year}`;
      if (facts[taxKey] == null) {
        const alias =
          toNum(facts[`TAX_LIABILITY_${year}`]) ??
          toNum(facts[`TAXES_LICENSES_${year}`]) ??
          toNum(facts[`INCOME_TAX_EXPENSE_${year}`]) ??
          toNum(facts[`TAX_PROVISION_${year}`]);
        if (alias !== null) facts[taxKey] = alias;
      }
    }

    // Interest expense aliasing: handles alternate keys from different form types
    for (const year of Array.from(yearsSet)) {
      const ieKey = `INTEREST_EXPENSE_${year}`;
      if (facts[ieKey] == null) {
        const alias =
          toNum(facts[`DEBT_SERVICE_${year}`]) ??
          toNum(facts[`INTEREST_ON_BUSINESS_INDEBTEDNESS_${year}`]) ??
          toNum(facts[`INTEREST_PAID_${year}`]);
        if (alias !== null) facts[ieKey] = alias;
      }
    }

    // Gross Profit derivation: derive if not stored
    for (const year of Array.from(yearsSet)) {
      const gpKey = `GROSS_PROFIT_${year}`;
      if (facts[gpKey] == null) {
        const rev = toNum(facts[`GROSS_RECEIPTS_${year}`]);
        const cogs = toNum(facts[`COGS_${year}`]) ?? toNum(facts[`COST_OF_GOODS_SOLD_${year}`]);
        if (rev !== null) {
          facts[gpKey] = rev - (cogs ?? 0);
        }
      }
    }

    // Net Operating Profit derivation: GP - Total OpEx
    for (const year of Array.from(yearsSet)) {
      const nopKey = `NET_OPERATING_PROFIT_${year}`;
      if (facts[nopKey] == null) {
        const grossProfit = toNum(facts[`GROSS_PROFIT_${year}`]);
        const totalOpEx =
          toNum(facts[`TOTAL_OPERATING_EXPENSES_${year}`]) ??
          toNum(facts[`TOTAL_DEDUCTIONS_${year}`]);
        if (grossProfit !== null && totalOpEx !== null) {
          facts[nopKey] = grossProfit - totalOpEx;
        }
      }
    }

    // EBITDA derivation: not stored as a fact — derive per year.
    // Formula: OBI (or NET_INCOME) + DEPRECIATION + INTEREST_EXPENSE
    for (const year of Array.from(yearsSet)) {
      const ebitdaKey = `EBITDA_${year}`;
      if (facts[ebitdaKey] == null) {
        const obi =
          toNum(facts[`ORDINARY_BUSINESS_INCOME_${year}`]) ??
          toNum(facts[`NET_INCOME_${year}`]);
        const dep  = toNum(facts[`DEPRECIATION_${year}`]) ?? 0;
        const ie   = toNum(facts[`INTEREST_EXPENSE_${year}`]) ?? 0;
        const s179 = toNum(facts[`SK_SECTION_179_DEDUCTION_${year}`]) ?? 0;
        if (obi !== null) facts[ebitdaKey] = obi + dep + ie + s179;
      }
    }

    // cf_ncads derivation: EBITDA as simplified NCADS (Phase 1)
    // QoE and owner add-backs are $0 until QoE engine runs
    for (const year of Array.from(yearsSet)) {
      const ncadsKey = `cf_ncads_${year}`;
      if (facts[ncadsKey] == null) {
        const alias = toNum(facts[`CASH_FLOW_AVAILABLE_${year}`]);
        if (alias !== null) {
          facts[ncadsKey] = alias;
        } else {
          // Fallback: use EBITDA as simplified NCADS
          const ebitda = toNum(facts[`EBITDA_${year}`]);
          const rental = toNum(facts[`RENTAL_INCOME_SCHED_E_${year}`]) ?? 0;
          if (ebitda !== null) facts[ncadsKey] = ebitda + rental;
        }
      }
    }

    // cf_ebitda_adjusted: EBITDA + QoE adjustments (seed as EBITDA base)
    for (const year of Array.from(yearsSet)) {
      const adjKey = `cf_ebitda_adjusted_${year}`;
      if (facts[adjKey] == null) {
        const ebitda = toNum(facts[`EBITDA_${year}`]);
        if (ebitda !== null) facts[adjKey] = ebitda;
      }
    }

    // PFS bare-key aliasing: map PFS_*_year facts to bare keys used by collateral/narrative generators
    const pfsNetWorthKey = Object.keys(facts).filter((k) => k.startsWith("PFS_NET_WORTH_")).sort().pop();
    if (pfsNetWorthKey) {
      const pfsYear = parseInt(pfsNetWorthKey.replace("PFS_NET_WORTH_", ""), 10);
      if (!isNaN(pfsYear)) {
        const pfsAliasMap: Record<string, string> = {
          [`PFS_NET_WORTH_${pfsYear}`]:          "personal_net_worth",
          [`PFS_LIQUID_ASSETS_${pfsYear}`]:       "personal_liquidity",
          [`PFS_TOTAL_ASSETS_${pfsYear}`]:        "personal_total_assets",
          [`PFS_TOTAL_LIABILITIES_${pfsYear}`]:   "personal_total_liabilities",
          [`PFS_REAL_ESTATE_MV_${pfsYear}`]:      "personal_real_estate_value",
          [`PFS_MORTGAGE_BALANCE_${pfsYear}`]:    "personal_mortgage_balance",
          [`PFS_STOCKS_BONDS_${pfsYear}`]:        "personal_stocks_bonds",
          [`PFS_TOTAL_ANNUAL_INCOME_${pfsYear}`]: "personal_annual_income",
          [`PFS_REAL_ESTATE_INCOME_${pfsYear}`]:  "personal_real_estate_income",
        };
        for (const [src, dest] of Object.entries(pfsAliasMap)) {
          if (facts[src] != null && facts[dest] == null) facts[dest] = facts[src];
        }
      }
    }

    return { facts, years: Array.from(yearsSet).sort((a, b) => a - b) };
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
