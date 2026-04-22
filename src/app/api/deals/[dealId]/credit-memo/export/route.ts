import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { composeSpreadOutput } from "@/lib/spreadOutput/spreadOutputComposer";
import { detectDealType } from "@/lib/spreadOutput/dealTypeDetection";
import { composeFlagReport } from "@/lib/flagEngine/flagComposer";
import { buildCreditMemoPdf } from "@/lib/creditMemo/buildCreditMemoPdf";
import type { SpreadOutputInput, DealType } from "@/lib/spreadOutput/types";
import type { FlagEngineInput, FlagEngineOutput } from "@/lib/flagEngine/types";
import type { CreditMemoInput } from "@/lib/creditMemo/types";
import type { ConsolidationBridge } from "@/lib/consolidation/consolidationBridge";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// GET — Generate and download Credit Memo PDF
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.status }
      );
    }
    const auth = access;

    // Phase 81: Trust enforcement — export requires committee-grade research
    const { loadAndEnforceResearchTrust } = await import("@/lib/research/trustEnforcement");
    const trustCheck = await loadAndEnforceResearchTrust(dealId, "committee_packet");
    if (!trustCheck.allowed) {
      return NextResponse.json(
        { ok: false, error: trustCheck.reason },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    // Parallel data loads
    const [factsResult, ratiosResult, dealMeta, qoeResult, trendResult, flagInput, consolidation] =
      await Promise.all([
        loadCanonicalFacts(sb, dealId),
        loadRatios(sb, dealId),
        loadDealMeta(sb, dealId),
        loadQoEReport(sb, dealId),
        loadTrendReport(sb, dealId),
        loadFlagEngineInput(sb, dealId),
        loadConsolidationBridge(sb, dealId),
      ]);

    // Detect deal type
    const dealType: DealType =
      (dealMeta.entity_type as DealType) ?? detectDealType(factsResult.facts);

    // Build flag report
    const flagReport: FlagEngineOutput = flagInput
      ? composeFlagReport(flagInput)
      : { deal_id: dealId, flags: [], critical_count: 0, elevated_count: 0, watch_count: 0, informational_count: 0, has_blocking_flags: false };

    // Build spread output report
    const spreadInput: SpreadOutputInput = {
      deal_id: dealId,
      deal_type: dealType,
      canonical_facts: factsResult.facts,
      ratios: ratiosResult,
      years_available: factsResult.years,
      qoe_report: qoeResult ?? undefined,
      trend_report: trendResult ?? undefined,
      flag_report: flagReport,
    };
    const spreadReport = composeSpreadOutput(spreadInput);

    // Build credit memo input
    const now = new Date().toISOString().split("T")[0];
    const memoInput: CreditMemoInput = {
      deal_id: dealId,
      deal_name: dealMeta.deal_name || `Deal ${dealId.slice(0, 8)}`,
      borrower_name: dealMeta.borrower_name || "Unknown Borrower",
      loan_amount: dealMeta.loan_amount ?? 0,
      loan_purpose: dealMeta.loan_purpose || "Commercial financing",
      prepared_by: auth.userId ?? "System",
      prepared_at: now,
      bank_name: dealMeta.bank_name || "Financial Institution",
      spread_report: spreadReport,
      flag_report: flagReport,
      consolidation_bridge: consolidation ?? undefined,
    };

    // Generate PDF
    const result = await buildCreditMemoPdf(memoInput);

    if (!result.ok || !result.pdf_bytes) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "PDF generation failed" },
        { status: 500 },
      );
    }

    // Return raw PDF bytes
    const safeName = memoInput.borrower_name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const buf = Buffer.from(result.pdf_bytes);
    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="CreditMemo_${safeName}_${now}.pdf"`,
        "Content-Length": String(buf.byteLength),
      },
    });
  } catch (err: unknown) {
    rethrowNextErrors(err);
    console.error("[credit-memo/export] GET error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DB loaders (reused patterns from spread-output route)
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
      .eq("deal_id", dealId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected");

    if (error || !data) return { facts: {}, years: [] };

    const facts: Record<string, unknown> = {};
    const yearsSet = new Set<number>();

    for (const row of data as FactRow[]) {
      const value = row.fact_value_num ?? row.fact_value_text ?? null;

      if (row.fact_period_end) {
        const year = new Date(row.fact_period_end).getFullYear();
        if (year >= 2000 && year <= 2100) {
          yearsSet.add(year);
          facts[`${row.fact_key}_${year}`] = value;
        }
      }

      facts[row.fact_key] = value;
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
  } catch { /* non-fatal */ }
  return ratios;
}

async function loadDealMeta(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<{
  entity_type: string | null;
  deal_name: string;
  borrower_name: string;
  loan_amount: number | null;
  loan_purpose: string;
  bank_name: string;
}> {
  try {
    const { data } = await (sb as any)
      .from("deals")
      .select("entity_type, name, borrower_name, loan_amount, loan_purpose, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    let bankName = "Financial Institution";
    if (data?.bank_id) {
      const { data: bankData } = await (sb as any)
        .from("banks")
        .select("name")
        .eq("id", data.bank_id)
        .maybeSingle();
      if (bankData?.name) bankName = bankData.name;
    }

    return {
      entity_type: data?.entity_type ?? null,
      deal_name: data?.name ?? "",
      borrower_name: data?.borrower_name ?? "",
      loan_amount: data?.loan_amount ?? null,
      loan_purpose: data?.loan_purpose ?? "",
      bank_name: bankName,
    };
  } catch {
    return { entity_type: null, deal_name: "", borrower_name: "", loan_amount: null, loan_purpose: "", bank_name: "" };
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
    return { deal_id: dealId, canonical_facts: facts, ratios, years_available: years };
  } catch {
    return null;
  }
}

async function loadConsolidationBridge(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<ConsolidationBridge | null> {
  try {
    const { data } = await (sb as any)
      .from("deal_consolidations")
      .select("bridge_json")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.bridge_json && typeof data.bridge_json === "object") {
      return data.bridge_json as ConsolidationBridge;
    }
    return null;
  } catch {
    return null;
  }
}
