import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { composeSpreadOutput } from "@/lib/spreadOutput/spreadOutputComposer";
import { detectDealType } from "@/lib/spreadOutput/dealTypeDetection";
import { composeFlagReport } from "@/lib/flagEngine/flagComposer";
import type { SpreadOutputInput, DealType } from "@/lib/spreadOutput/types";
import type { FlagEngineInput } from "@/lib/flagEngine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    // Build SpreadOutputInput from DB — parallel queries
    const [factsResult, ratiosResult, dealResult, qoeResult, trendResult, flagInput] =
      await Promise.all([
        loadCanonicalFacts(sb, dealId),
        loadRatios(sb, dealId),
        loadDealMeta(sb, dealId),
        loadQoEReport(sb, dealId),
        loadTrendReport(sb, dealId),
        loadFlagEngineInput(sb, dealId),
      ]);

    // Detect deal type
    const dealType: DealType =
      (dealResult.entity_type as DealType) ??
      detectDealType(factsResult.facts);

    // Build flag report if we have input
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
      trend_report: trendResult ?? undefined,
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

    // EBITDA derivation: not stored as a fact — derive per year.
    // Formula: OBI (or NET_INCOME) + DEPRECIATION + INTEREST_EXPENSE
    for (const year of Array.from(yearsSet)) {
      const ebitdaKey = `EBITDA_${year}`;
      if (facts[ebitdaKey] == null) {
        const obi =
          toNum(facts[`ORDINARY_BUSINESS_INCOME_${year}`]) ??
          toNum(facts[`NET_INCOME_${year}`]);
        const dep = toNum(facts[`DEPRECIATION_${year}`]) ?? 0;
        const ie  = toNum(facts[`INTEREST_EXPENSE_${year}`]) ?? 0;
        if (obi !== null) facts[ebitdaKey] = obi + dep + ie;
      }
    }

    // cf_ncads aliasing: template key → snapshot key
    // The 3-pass pricing pipeline persists cash_flow_available;
    // alias it so the spread template can find it.
    for (const year of Array.from(yearsSet)) {
      const ncadsKey = `cf_ncads_${year}`;
      if (facts[ncadsKey] == null) {
        const alias = toNum(facts[`CASH_FLOW_AVAILABLE_${year}`]);
        if (alias !== null) facts[ncadsKey] = alias;
      }
    }

    return { facts, years: Array.from(yearsSet).sort((a, b) => a - b) };
  } catch {
    return { facts: {}, years: [] };
  }
}

async function loadRatios(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<Record<string, number | null>> {
  const ratios: Record<string, number | null> = {};

  try {
    const { data } = await (sb as any)
      .from("deal_truth_snapshots")
      .select("truth_json")
      .eq("deal_id", dealId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.truth_json && typeof data.truth_json === "object") {
      for (const [key, val] of Object.entries(data.truth_json as Record<string, unknown>)) {
        if (typeof val === "number") ratios[key] = val;
      }
    }
  } catch {
    // non-fatal
  }

  return ratios;
}

async function loadDealMeta(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<{ entity_type: string | null }> {
  try {
    const { data } = await (sb as any)
      .from("deals")
      .select("entity_type")
      .eq("id", dealId)
      .maybeSingle();

    return { entity_type: data?.entity_type ?? null };
  } catch {
    return { entity_type: null };
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

async function loadFlagEngineInput(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<FlagEngineInput | null> {
  try {
    const { facts, years } = await loadCanonicalFacts(sb, dealId);
    const ratios = await loadRatios(sb, dealId);

    if (Object.keys(facts).length === 0) return null;

    return {
      deal_id: dealId,
      canonical_facts: facts,
      ratios,
      years_available: years,
    };
  } catch {
    return null;
  }
}
