import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

async function assertDealBank(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  bankId: string,
) {
  const { data: deal, error } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .single();
  if (error || !deal || deal.bank_id !== bankId) return false;
  return true;
}
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  if (!(await assertDealBank(sb, dealId, bankId))) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const { data, error } = await sb
    .from("deal_pricing_inputs")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inputs: data ?? null });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  if (!(await assertDealBank(sb, dealId, bankId))) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const body = await req.json();

  const patch = {
    deal_id: dealId,
    index_code: body.index_code ?? "SOFR",
    index_tenor: body.index_tenor ?? null,
    base_rate_override_pct: body.base_rate_override_pct ?? null,
    spread_override_bps: body.spread_override_bps ?? null,
    loan_amount: body.loan_amount ?? null,
    term_months: body.term_months ?? 120,
    amort_months: body.amort_months ?? 300,
    interest_only_months: body.interest_only_months ?? 0,
    notes: body.notes ?? null,
  };

  const { data, error } = await sb
    .from("deal_pricing_inputs")
    .upsert(patch, { onConflict: "deal_id" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Seed deal_structural_pricing synchronously (fire-and-forget fails in Vercel serverless)
  try {
    const { getLatestIndexRates } = await import("@/lib/rates/indexRates");
    const rates = await getLatestIndexRates();
    const indexCode = (patch.index_code ?? "SOFR") as "UST_5Y" | "SOFR" | "PRIME";
    const liveRate = rates[indexCode];
    const baseRatePct = patch.base_rate_override_pct ?? liveRate?.ratePct ?? 0;
    const spreadBps = patch.spread_override_bps ?? 0;
    const allInPct = baseRatePct + spreadBps / 100;
    const principal = Number(patch.loan_amount ?? 0);
    const n = Math.max(1, Number(patch.amort_months ?? 300));
    const r = allInPct / 100 / 12;
    const monthlyPI = r > 0 ? (principal * r) / (1 - Math.pow(1 + r, -n)) : principal / n;
    const annualDebtService = monthlyPI * 12;

    if (annualDebtService > 0 && principal > 0) {
      const row = {
        deal_id: dealId,
        bank_id: bankId,
        loan_request_id: null,
        loan_amount: principal,
        term_months: Number(patch.term_months ?? 120),
        amort_months: n,
        interest_only_months: Number(patch.interest_only_months ?? 0),
        rate_index: indexCode,
        requested_spread_bps: spreadBps,
        structural_rate_pct: allInPct,
        index_rate_pct: liveRate?.ratePct ?? null,
        monthly_payment_est: monthlyPI,
        annual_debt_service_est: annualDebtService,
        floor_rate_pct: 0,
        rate_type: "floating",
        source: "pricing_inputs",
        computed_at: new Date().toISOString(),
      };

      // Unique constraint is (deal_id, loan_request_id) but NULLs are distinct in PG,
      // so do select-then-update/insert instead of upsert.
      const { data: existing } = await sb
        .from("deal_structural_pricing")
        .select("id")
        .eq("deal_id", dealId)
        .is("loan_request_id", null)
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        await sb.from("deal_structural_pricing").update(row).eq("id", existing.id);
      } else {
        await sb.from("deal_structural_pricing").insert(row);
      }
    }
  } catch (err: any) {
    console.warn("[pricing/inputs] structural pricing seed failed (non-fatal):", err?.message);
  }

  return NextResponse.json({ ok: true, inputs: data });
}
