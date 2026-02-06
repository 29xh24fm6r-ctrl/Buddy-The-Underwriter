import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getLatestIndexRates } from "@/lib/rates/indexRates";
import { buildPricingMemoMarkdown } from "@/lib/pricing/memoBlock";
import {
  buildExplainability,
  computeMonthlyIO,
  computeMonthlyPI,
  type PricingInputs,
} from "@/lib/pricing/explainability";
import { writeEvent } from "@/lib/ledger/writeEvent";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; quoteId: string }> },
) {
  const { dealId, quoteId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const lockReason = body.lock_reason ? String(body.lock_reason) : "Locked for committee";

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .single();
  if (dealErr || !deal || deal.bank_id !== bankId) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const { data: quote, error: qErr } = await sb
    .from("deal_pricing_quotes")
    .select("id, status")
    .eq("id", quoteId)
    .eq("deal_id", dealId)
    .single();

  if (qErr || !quote) {
    return NextResponse.json({ ok: false, error: "quote not found" }, { status: 404 });
  }
  if (quote.status === "locked") {
    return NextResponse.json({ ok: true, status: "locked" });
  }

  let underwritingSnapshotId: string | null = null;
  try {
    const snap = await sb
      .from("deal_underwriting_snapshots" as any)
      .select("id")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    underwritingSnapshotId = (snap as any)?.data?.id ?? null;
  } catch {
    underwritingSnapshotId = null;
  }

  const { data: updated, error: uErr } = await sb
    .from("deal_pricing_quotes")
    .update({
      status: "locked",
      locked_at: new Date().toISOString(),
      locked_by: "system",
      underwriting_snapshot_id: underwritingSnapshotId,
      lock_reason: lockReason,
    })
    .eq("id", quoteId)
    .eq("deal_id", dealId)
    .select("*")
    .single();

  if (uErr) {
    return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
  }

  try {
    const { data: dealRow } = await sb
      .from("deals")
      .select("borrower_name")
      .eq("id", dealId)
      .single();

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
    const spreadBps = inputs.spread_override_bps ?? Number(updated.spread_bps ?? 0);
    const allInPct = baseRatePct + spreadBps / 100;

    const paymentPI =
      inputs.loan_amount != null
        ? computeMonthlyPI(Number(inputs.loan_amount), allInPct, inputs.amort_months)
        : null;
    const paymentIO =
      inputs.loan_amount != null
        ? computeMonthlyIO(Number(inputs.loan_amount), allInPct)
        : null;

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

    let explain = explainRow?.breakdown_json ?? null;
    if (!explain) {
      explain = buildExplainability({
        inputs,
        latestRate,
        quote: core,
        policyBreakdown: updated.policy_breakdown_json ?? updated.pricing_explain ?? null,
      });

      await sb.from("deal_pricing_explainability").upsert({
        quote_id: quoteId,
        breakdown_json: explain,
        narrative: explain.summary,
      });
    }

    const md = buildPricingMemoMarkdown({
      dealName: dealRow?.borrower_name ?? dealId,
      quoteId,
      inputs,
      latestRate,
      quote: core,
      explain,
    });

    const json = {
      inputs,
      latestRate,
      core,
      explain,
      locked_at: updated.locked_at,
      lock_reason: updated.lock_reason,
    };

    await sb.from("deal_pricing_memo_blocks").upsert({
      quote_id: quoteId,
      content_md: md,
      content_json: json,
    });
  } catch (err) {
    console.warn("[pricing.lock] memo persistence failed", err);
  }

  // Non-fatal lifecycle ledger event
  writeEvent({
    dealId,
    kind: "pricing.quote.locked",
    scope: "pricing",
    action: "quote_locked",
    output: { quoteId, lockReason },
  }).catch(() => {});

  return NextResponse.json({ ok: true, quote: updated });
}
