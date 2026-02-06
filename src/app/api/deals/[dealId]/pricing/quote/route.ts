import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getLatestIndexRates, type IndexCode } from "@/lib/rates/indexRates";
import { runDealRiskPricing } from "@/lib/pricing/runDealRiskPricing";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function monthlyPaymentPI(principal: number, annualRatePct: number, nMonths: number) {
  const r = annualRatePct / 100 / 12;
  if (nMonths <= 0) return null;
  if (r === 0) return principal / nMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -nMonths));
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select(
      "id, bank_id, risk_score, requested_loan_amount, project_cost, property_value, noi, dscr, ltv",
    )
    .eq("id", dealId)
    .maybeSingle();

  if (!deal || deal.bank_id !== bankId) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const { data: inputs } = await sb
    .from("deal_pricing_inputs")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!inputs?.loan_amount) {
    return NextResponse.json(
      { ok: false, error: "loan_amount required before quoting" },
      { status: 400 },
    );
  }

  const indexCode = (inputs.index_code ?? "SOFR") as IndexCode;
  const rates = await getLatestIndexRates();
  const live = rates[indexCode];
  if (!live) {
    return NextResponse.json(
      { ok: false, error: "unknown index_code" },
      { status: 400 },
    );
  }

  const { data: snapshot, error: snapErr } = await sb
    .from("rate_index_snapshots")
    .insert({
      bank_id: bankId,
      deal_id: dealId,
      index_code: live.code,
      index_label: live.label,
      index_rate_pct: live.ratePct,
      as_of_date: live.asOf,
      source: live.source,
      source_url: live.sourceUrl ?? null,
      raw: live.raw ?? null,
    })
    .select("*")
    .single();

  if (snapErr) {
    return NextResponse.json({ ok: false, error: snapErr.message }, { status: 500 });
  }

  await logPipelineLedger(sb, {
    bank_id: bankId,
    deal_id: dealId,
    event_key: "pricing.rate_snapshot",
    status: "ok",
    payload: {
      snapshotId: snapshot.id,
      index_code: live.code,
      ratePct: live.ratePct,
      asOf: live.asOf,
      source: live.source,
    },
  });

  const model = await runDealRiskPricing(deal);
  const modelSpreadBps = Number(model?.quote?.spreadBps ?? 0);
  const spreadBps = inputs.spread_override_bps ?? modelSpreadBps;
  const baseRatePct = inputs.base_rate_override_pct ?? Number(snapshot.index_rate_pct);
  const allInRatePct = baseRatePct + spreadBps / 100;

  const principal = Number(inputs.loan_amount);
  const pi = monthlyPaymentPI(principal, allInRatePct, Number(inputs.amort_months));
  const io = principal * (allInRatePct / 100 / 12);

  const pricing_explain = model?.explain ?? null;

  const { data: quote, error: qErr } = await sb
    .from("deal_pricing_quotes")
    .insert({
      bank_id: bankId,
      deal_id: dealId,
      rate_snapshot_id: snapshot.id,
      index_code: indexCode,
      base_rate_pct: baseRatePct,
      spread_bps: spreadBps,
      all_in_rate_pct: allInRatePct,
      loan_amount: principal,
      term_months: inputs.term_months,
      amort_months: inputs.amort_months,
      interest_only_months: inputs.interest_only_months,
      monthly_payment_pi: pi,
      monthly_payment_io: inputs.interest_only_months > 0 ? io : null,
      pricing_policy_id: null,
      pricing_policy_version: null,
      pricing_model_hash: null,
      pricing_explain,
      status: "draft",
    })
    .select("*")
    .single();

  if (qErr) {
    return NextResponse.json({ ok: false, error: qErr.message }, { status: 500 });
  }

  await logPipelineLedger(sb, {
    bank_id: bankId,
    deal_id: dealId,
    event_key: "pricing.quote",
    status: "ok",
    payload: {
      quoteId: quote.id,
      indexCode,
      baseRatePct,
      spreadBps,
      allInRatePct,
      rate_snapshot_id: snapshot.id,
    },
  });

  // Non-fatal lifecycle ledger event
  writeEvent({
    dealId,
    kind: "pricing.quote.generated",
    scope: "pricing",
    action: "quote_generated",
    output: { quoteId: quote.id, allInRatePct, spreadBps },
  }).catch(() => {});

  return NextResponse.json({ ok: true, quote, snapshot });
}
