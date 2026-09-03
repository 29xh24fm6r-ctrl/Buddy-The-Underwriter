import "server-only";
import { buildDealSnapshotForAi } from "@/lib/underwriting/runBankerAnalysisPipeline";

import { NextRequest, NextResponse } from "next/server";
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
    console.error("[ai-risk] GET error", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — run AI risk assessment
// ---------------------------------------------------------------------------
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 404 });
    }

    const sb = supabaseAdmin();

    // ── Load deal snapshot ──────────────────────────────────────────────────
    // Shared with the banker analysis pipeline: canonical underwriting metrics
    // plus complete-fiscal-year vs interim separation (lib/underwriting/aiDealSnapshot).
    const dealSnapshot = await buildDealSnapshotForAi(sb, dealId, access.bankId);
    const evidenceIndex = (dealSnapshot.evidenceIndex ?? []) as Array<{ docId: string; label: string; kind: "pdf" }>;

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
    console.error("[ai-risk] POST error", e);
    return NextResponse.json({ ok: false, error: (e as Error)?.message ?? "unexpected_error" }, { status: 500 });
  }
}
