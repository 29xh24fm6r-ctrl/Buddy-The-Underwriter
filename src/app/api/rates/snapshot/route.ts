import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getLatestIndexRates, type IndexCode } from "@/lib/rates/indexRates";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sb = supabaseAdmin();
  const bankId = await getCurrentBankId();
  const body = await req.json().catch(() => ({}));

  const indexCode = (body.index_code ?? "SOFR") as IndexCode;
  const dealId = body.deal_id ?? null;

  const rates = await getLatestIndexRates();
  const r = rates[indexCode];
  if (!r) {
    return NextResponse.json(
      { ok: false, error: "unknown index_code" },
      { status: 400 },
    );
  }

  const { data, error } = await sb
    .from("rate_index_snapshots")
    .insert({
      bank_id: bankId,
      deal_id: dealId,
      index_code: r.code,
      index_label: r.label,
      index_rate_pct: r.ratePct,
      as_of_date: r.asOf,
      source: r.source,
      source_url: r.sourceUrl ?? null,
      raw: r.raw ?? null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (dealId) {
    await logPipelineLedger(sb, {
      bank_id: bankId,
      deal_id: dealId,
      event_key: "pricing.rate_snapshot",
      status: "ok",
      payload: {
        index_code: r.code,
        ratePct: r.ratePct,
        asOf: r.asOf,
        source: r.source,
      },
    });
  }

  return NextResponse.json({ ok: true, snapshot: data });
}
