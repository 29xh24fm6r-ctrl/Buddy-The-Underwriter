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

    for (const row of data as FactRow[]) {
      facts[row.fact_key] = row.fact_value_num ?? row.fact_value_text ?? null;
      if (row.fact_period_end) {
        const year = new Date(row.fact_period_end).getFullYear();
        if (year >= 2000 && year <= 2100) yearsSet.add(year);
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
