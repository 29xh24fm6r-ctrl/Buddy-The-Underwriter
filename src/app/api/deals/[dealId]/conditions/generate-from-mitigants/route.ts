import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { generateMitigantConditionsForDeal } from "@/lib/conditions/generateMitigantConditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const sb = await supabaseServer();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user)
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  const { dealId } = await ctx.params;
  if (!dealId)
    return NextResponse.json(
      { ok: false, error: "missing_deal_id" },
      { status: 400 },
    );

  const bankId = await getCurrentBankId();

  const dealRes = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();
  if (dealRes.error)
    return NextResponse.json(
      { ok: false, error: "deal_fetch_failed", detail: dealRes.error.message },
      { status: 500 },
    );
  if (!dealRes.data)
    return NextResponse.json(
      { ok: false, error: "deal_not_found" },
      { status: 404 },
    );
  if (String(dealRes.data.bank_id) !== String(bankId))
    return NextResponse.json(
      { ok: false, error: "wrong_bank" },
      { status: 403 },
    );

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const dueDaysOverride =
    body?.due_days !== undefined ? Number(body.due_days) : null;

  const result = await generateMitigantConditionsForDeal(dealId, bankId, {
    sb: sb as any,
    createdBy: auth.user.id,
    dueDaysOverride,
  });

  return NextResponse.json({
    ok: true,
    created: result.created,
    skipped: result.skipped,
    open_mitigants: result.open_mitigants,
  });
}
