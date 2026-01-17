import "server-only";

import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import type { SupabaseClient } from "@supabase/supabase-js";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MemoPdfBuildOptions = {
  sb: SupabaseClient;
  bankId: string;
  dealId: string;
  quoteId: string;
};

class MemoPdfError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function renderMemoPdf(args: {
  dealName: string;
  dealId: string;
  quoteId: string;
  md: string;
  lockedAt?: string | null;
}) {
  const { dealName, dealId, quoteId, md, lockedAt } = args;
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 48 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Pricing Memo Appendix", { align: "center" });
    doc.moveDown();
    doc.fontSize(10);
    doc.text(`Deal: ${dealName} (${dealId})`);
    doc.text(`Quote ID: ${quoteId}`);
    if (lockedAt) doc.text(`Locked At: ${lockedAt}`);
    doc.moveDown();

    doc.fontSize(10).text(md, { lineGap: 2 });

    doc.end();
  });
}

export async function buildPricingMemoAppendixPdfBytes(
  opts: MemoPdfBuildOptions,
): Promise<Uint8Array> {
  const { sb, bankId, dealId, quoteId } = opts;

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id, borrower_name")
    .eq("id", dealId)
    .single();

  if (dealErr || !deal || deal.bank_id !== bankId) {
    throw new MemoPdfError(404, "not found");
  }

  const { data: quote, error: qErr } = await sb
    .from("deal_pricing_quotes")
    .select("*")
    .eq("id", quoteId)
    .eq("deal_id", dealId)
    .single();

  if (qErr || !quote) {
    throw new MemoPdfError(404, "quote not found");
  }

  const { data: memoRow } = await sb
    .from("deal_pricing_memo_blocks")
    .select("content_md")
    .eq("quote_id", quoteId)
    .maybeSingle();

  let md = memoRow?.content_md ?? null;

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
        policyBreakdown: quote.policy_breakdown_json ?? quote.pricing_explain ?? null,
      });

      await sb.from("deal_pricing_explainability").upsert({
        quote_id: quoteId,
        breakdown_json: explain,
        narrative: explain.summary,
      });
    }

    md = buildPricingMemoMarkdown({
      dealName: deal.borrower_name ?? deal.id,
      quoteId,
      inputs,
      latestRate,
      quote: core,
      explain,
    });

    if (quote.status === "locked") {
      await sb.from("deal_pricing_memo_blocks").upsert({
        quote_id: quoteId,
        content_md: md,
        content_json: { inputs, latestRate, core, explain },
      });
    }
  }

  if (!md) {
    throw new MemoPdfError(409, "memo_not_available");
  }

  const pdf = await renderMemoPdf({
    dealName: deal.borrower_name ?? deal.id,
    dealId,
    quoteId,
    md,
    lockedAt: quote.locked_at ?? null,
  });

  return new Uint8Array(pdf);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; quoteId: string }> },
) {
  const { dealId, quoteId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  try {
    const pdfBytes = await buildPricingMemoAppendixPdfBytes({
      sb,
      bankId,
      dealId,
      quoteId,
    });

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="Pricing_Memo_Appendix_${dealId}_${quoteId}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof MemoPdfError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    console.error("pricing memo appendix pdf error", error);
    return NextResponse.json({ ok: false, error: "memo_pdf_failed" }, { status: 500 });
  }
}
