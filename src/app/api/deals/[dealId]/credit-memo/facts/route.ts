import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 15;

const ALLOWED_FACT_TYPES = new Set(["COLLATERAL", "SOURCES_USES", "FINANCIAL_ANALYSIS"]);

const ALLOWED_FACT_KEYS: Record<string, Set<string>> = {
  COLLATERAL: new Set(["AS_IS_VALUE", "STABILIZED_VALUE", "GROSS_VALUE", "NET_VALUE", "DISCOUNTED_VALUE"]),
  SOURCES_USES: new Set(["TOTAL_PROJECT_COST", "BORROWER_EQUITY", "BORROWER_EQUITY_PCT", "BANK_LOAN_TOTAL"]),
  FINANCIAL_ANALYSIS: new Set(["CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE", "ANNUAL_DEBT_SERVICE_STRESSED_300BPS", "DSCR", "DSCR_STRESSED_300BPS", "EXCESS_CASH_FLOW"]),
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const rawFacts: Array<{ factType: string; factKey: string; value: number }> = body?.facts ?? [];

    if (!Array.isArray(rawFacts) || rawFacts.length === 0) {
      return NextResponse.json({ ok: false, error: "no_facts_provided" }, { status: 400 });
    }

    const accepted: typeof rawFacts = [];
    const rejected: string[] = [];
    for (const f of rawFacts) {
      if (!ALLOWED_FACT_TYPES.has(f.factType)) { rejected.push(`${f.factType}.${f.factKey}: unknown fact type`); continue; }
      if (!ALLOWED_FACT_KEYS[f.factType]?.has(f.factKey)) { rejected.push(`${f.factType}.${f.factKey}: unknown fact key`); continue; }
      if (typeof f.value !== "number" || !Number.isFinite(f.value)) { rejected.push(`${f.factType}.${f.factKey}: invalid value`); continue; }
      accepted.push(f);
    }

    if (accepted.length === 0) {
      return NextResponse.json({ ok: false, error: "all_facts_rejected", rejected }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const now = new Date().toISOString();
    const currentYear = new Date().getFullYear();
    const periodStart = `${currentYear - 1}-01-01`;
    const periodEnd = `${currentYear - 1}-12-31`;

    // Mark existing active facts for the same keys as superseded
    for (const f of accepted) {
      await sb
        .from("deal_financial_facts")
        .update({ is_superseded: true })
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .eq("fact_type", f.factType)
        .eq("fact_key", f.factKey)
        .eq("is_superseded", false);
    }

    // Insert new facts
    const { error: insertErr } = await sb.from("deal_financial_facts").insert(
      accepted.map(f => ({
        deal_id: dealId,
        bank_id: access.bankId,
        fact_type: f.factType,
        fact_key: f.factKey,
        fact_value_num: f.value,
        fact_value_text: null,
        owner_type: "DEAL",
        owner_entity_id: "00000000-0000-0000-0000-000000000000",
        source_document_id: null,
        fact_period_start: periodStart,
        fact_period_end: periodEnd,
        is_superseded: false,
        resolution_status: "accepted",
        confidence: 1.0,
        provenance: {
          source_type: "BANKER_MANUAL_ENTRY",
          entered_by: userId,
          entered_at: now,
        },
        created_at: now,
      }))
    );

    if (insertErr) {
      return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, written: accepted.length, rejected: rejected.length > 0 ? rejected : undefined });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unexpected" }, { status: 500 });
  }
}
