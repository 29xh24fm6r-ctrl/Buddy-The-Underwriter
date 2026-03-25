import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAIProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // AI inference can be slow

type Ctx = { params: Promise<{ dealId: string }> };

// ---------------------------------------------------------------------------
// GET — return the latest ai_risk_run for this deal (if any)
// ---------------------------------------------------------------------------
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 404 });
    }

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("ai_risk_runs")
      .select("id, grade, base_rate_bps, risk_premium_bps, result_json, created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ ok: true, run: data ?? null });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: e.code === "not_authenticated" ? 401 : 403 });
    }
    console.error("[ai-risk] GET error", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — run AI risk assessment
// ---------------------------------------------------------------------------
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 404 });
    }

    const sb = supabaseAdmin();

    // ── Load deal snapshot ──────────────────────────────────────────────────
    const [dealRow, loanReqRow, , factsRows, docsRows] = await Promise.all([
      sb.from("deals").select("entity_type, borrower_id, loan_amount").eq("id", dealId).maybeSingle(),
      sb.from("deal_loan_requests").select("loan_purpose, purpose, requested_amount, product_type").eq("deal_id", dealId).order("request_number", { ascending: true }).limit(1).maybeSingle(),
      Promise.resolve(null), // placeholder — borrower lookup below
      sb.from("deal_financial_facts").select("fact_key, fact_value_num, fact_value_text, fact_period_end").eq("deal_id", dealId).eq("is_superseded", false).neq("resolution_status", "rejected"),
      sb.from("deal_documents").select("id, doc_type, file_name, original_name, status").eq("deal_id", dealId).eq("bank_id", access.bankId).limit(50),
    ]);

    // Borrower lookup
    let borrowerName: string | null = null;
    let naicsCode: string | null = null;
    if (dealRow.data?.borrower_id) {
      const { data: bRow } = await sb
        .from("borrowers")
        .select("legal_name, naics_code")
        .eq("id", dealRow.data.borrower_id)
        .maybeSingle();
      borrowerName = bRow?.legal_name ?? null;
      naicsCode = bRow?.naics_code ?? null;
    }

    // Aggregate key financial facts by year
    const facts: Record<string, number | null> = {};
    const yearsSet = new Set<number>();
    for (const row of (factsRows.data ?? [])) {
      if (!row.fact_period_end || row.fact_value_num == null) continue;
      const year = new Date(row.fact_period_end).getFullYear();
      if (year < 2000 || year > 2100) continue;
      if (!row.fact_key.startsWith("PFS_")) yearsSet.add(year);
      const key = `${row.fact_key}_${year}`;
      facts[key] = row.fact_value_num;
    }
    const years = Array.from(yearsSet).sort((a, b) => a - b);
    const latestYear = years[years.length - 1] ?? null;

    // Build compact snapshot for AI consumption
    const dealSnapshot: Record<string, unknown> = {
      dealId,
      borrowerName: borrowerName ?? "Unknown Borrower",
      entityType: dealRow.data?.entity_type ?? null,
      naicsCode,
      loanAmount: loanReqRow.data?.requested_amount ?? dealRow.data?.loan_amount ?? null,
      loanPurpose: loanReqRow.data?.loan_purpose ?? loanReqRow.data?.purpose ?? null,
      productType: loanReqRow.data?.product_type ?? "SBA",
      yearsAvailable: years,
      latestYear,
      // Key metrics — latest year
      grossReceipts: latestYear ? (facts[`GROSS_RECEIPTS_${latestYear}`] ?? facts[`TOTAL_REVENUE_${latestYear}`] ?? null) : null,
      ebitda: latestYear ? (facts[`EBITDA_${latestYear}`] ?? null) : null,
      netIncome: latestYear ? (facts[`NET_INCOME_${latestYear}`] ?? facts[`ORDINARY_BUSINESS_INCOME_${latestYear}`] ?? null) : null,
      depreciation: latestYear ? (facts[`DEPRECIATION_${latestYear}`] ?? null) : null,
      interestExpense: latestYear ? (facts[`INTEREST_EXPENSE_${latestYear}`] ?? null) : null,
      totalAssets: latestYear ? (facts[`TOTAL_ASSETS_${latestYear}`] ?? null) : null,
      totalLiabilities: latestYear ? (facts[`TOTAL_LIABILITIES_${latestYear}`] ?? null) : null,
      // Multi-year revenue trend for trend analysis
      revenueTrend: years.reduce<Record<string, number | null>>((acc, y) => {
        acc[String(y)] = facts[`GROSS_RECEIPTS_${y}`] ?? facts[`TOTAL_REVENUE_${y}`] ?? null;
        return acc;
      }, {}),
    };

    // Evidence index for AI citations
    const evidenceIndex = (docsRows.data ?? []).map((d: { id: string; doc_type?: string; file_name?: string; original_name?: string }) => ({
      docId: d.id,
      label: d.doc_type ?? d.file_name ?? d.original_name ?? d.id,
      kind: "pdf" as const,
    }));

    // ── Run AI risk assessment ───────────────────────────────────────────────
    const provider = getAIProvider();
    const riskResult = await provider.generateRisk({ dealId, dealSnapshot, evidenceIndex });

    // ── Persist result ───────────────────────────────────────────────────────
    const { data: runRow, error: insertErr } = await sb
      .from("ai_risk_runs")
      .insert({
        deal_id: dealId,
        bank_id: access.bankId,
        grade: riskResult.grade,
        base_rate_bps: riskResult.baseRateBps,
        risk_premium_bps: riskResult.riskPremiumBps,
        result_json: riskResult,
      })
      .select("id, created_at")
      .single();

    if (insertErr) {
      console.error("[ai-risk] insert failed (non-fatal)", insertErr.message);
    }

    return NextResponse.json({
      ok: true,
      run: {
        id: runRow?.id ?? null,
        createdAt: runRow?.created_at ?? null,
        ...riskResult,
      },
    });
  } catch (e: unknown) {
    rethrowNextErrors(e);
    if (e instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: e.code }, { status: e.code === "not_authenticated" ? 401 : 403 });
    }
    console.error("[ai-risk] POST error", e);
    return NextResponse.json({ ok: false, error: (e as Error)?.message ?? "unexpected_error" }, { status: 500 });
  }
}
