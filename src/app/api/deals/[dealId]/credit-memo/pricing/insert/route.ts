import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getLatestIndexRates } from "@/lib/rates/indexRates";
import { buildPricingMemoMarkdown } from "@/lib/pricing/memoBlock";
import {
  computeMonthlyIO,
  computeMonthlyPI,
  type PricingInputs,
} from "@/lib/pricing/explainability";

export const dynamic = "force-dynamic";

/**
 * Bank-grade insert:
 * - Always returns { md } so UI can show success even if auto-insert isn't configured.
 * - If a credit memo draft exists, append the markdown into the latest draft.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const body = await req.json();
  const quoteId = String(body.quote_id ?? "");
  if (!quoteId) {
    return NextResponse.json({ ok: false, error: "quote_id required" }, { status: 400 });
  }

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id, borrower_name")
    .eq("id", dealId)
    .single();
  if (dealErr || !deal || deal.bank_id !== bankId) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const { data: quote, error: qErr } = await sb
    .from("deal_pricing_quotes")
    .select("*")
    .eq("id", quoteId)
    .eq("deal_id", dealId)
    .single();

  if (qErr || !quote) {
    return NextResponse.json({ ok: false, error: "quote not found" }, { status: 404 });
  }

  const { data: memoRow } = await sb
    .from("deal_pricing_memo_blocks")
    .select("*")
    .eq("quote_id", quoteId)
    .maybeSingle();

  let md = memoRow?.content_md ?? null;
  let json = memoRow?.content_json ?? null;

  if (!md) {
    const { data: inputsRow } = await sb
      .from("deal_pricing_inputs")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle();
    const inputs: PricingInputs = {
      index_code: inputsRow?.index_code ?? "SOFR",
      loan_amount: inputsRow?.loan_amount ?? null,
      term_months: inputsRow?.term_months ?? 120,
      amort_months: inputsRow?.amort_months ?? 300,
      interest_only_months: inputsRow?.interest_only_months ?? 0,
      spread_override_bps: inputsRow?.spread_override_bps ?? null,
      base_rate_override_pct: inputsRow?.base_rate_override_pct ?? null,
    };

    const latest = await getLatestIndexRates();
    const latestRate = latest[inputs.index_code];

    const baseRatePct = inputs.base_rate_override_pct ?? latestRate.ratePct;
    const spreadBps = inputs.spread_override_bps ?? Number(quote.spread_bps ?? 0);
    const allInPct = baseRatePct + spreadBps / 100;

    const paymentPI =
      inputs.loan_amount != null
        ? computeMonthlyPI(Number(inputs.loan_amount), allInPct, inputs.amort_months)
        : null;
    const paymentIO =
      inputs.loan_amount != null ? computeMonthlyIO(Number(inputs.loan_amount), allInPct) : null;

    const core = {
      base_rate_pct: baseRatePct,
      spread_bps: spreadBps,
      all_in_rate_pct: allInPct,
      payment_pi_monthly: paymentPI,
      payment_io_monthly: inputs.interest_only_months > 0 ? paymentIO : null,
    };

    const { data: explainRow } = await sb
      .from("deal_pricing_explainability")
      .select("*")
      .eq("quote_id", quoteId)
      .maybeSingle();

    const explain = explainRow?.breakdown_json ?? {
      summary: `Base ${inputs.index_code} + spread = all-in.`,
      drivers: [{ label: "Risk-based spread", bps: spreadBps, source: "policy", confidence: 0.7 }],
      missingInputs: [],
      confidence: 0.75,
      meta: {},
    };

    md = buildPricingMemoMarkdown({
      dealName: deal.borrower_name ?? deal.id,
      quoteId,
      inputs,
      latestRate,
      quote: core,
      explain,
    });

    json = { inputs, latestRate, core, explain };

    if (quote.status === "locked") {
      await sb.from("deal_pricing_memo_blocks").upsert({
        quote_id: quoteId,
        content_md: md,
        content_json: json,
      });
    }
  }

  if (!md) {
    return NextResponse.json({ ok: true, inserted: false, md: null, hint: "memo_not_available" });
  }

  const latestDraft = await sb
    .from("credit_memo_drafts")
    .select("id, body_md")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestDraft?.data?.id) {
    const next =
      (latestDraft.data.body_md ? String(latestDraft.data.body_md) + "\n\n" : "") + md;
    await sb.from("credit_memo_drafts").update({ body_md: next }).eq("id", latestDraft.data.id);
    return NextResponse.json({
      ok: true,
      inserted: true,
      table: "credit_memo_drafts",
      draft_id: latestDraft.data.id,
      md,
      json,
    });
  }

  return NextResponse.json({ ok: true, inserted: false, md, json });
}
