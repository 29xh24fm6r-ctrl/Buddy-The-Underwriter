import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 404 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await (sb as any)
    .from("deal_existing_debt_schedule")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, existingDebt: data ?? [] });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Params },
) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 404 });
  }

  const body = await req.json();
  if (!body.lender_name) {
    return NextResponse.json({ ok: false, error: "lender_name is required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const row = {
    deal_id: dealId,
    bank_id: access.bankId ?? null,
    lender_name: body.lender_name,
    loan_type: body.loan_type ?? null,
    original_amount: body.original_amount ?? null,
    current_balance: body.current_balance ?? null,
    interest_rate_pct: body.interest_rate_pct ?? null,
    maturity_date: body.maturity_date ?? null,
    monthly_payment: body.monthly_payment ?? null,
    annual_debt_service: body.annual_debt_service ?? null,
    is_being_refinanced: body.is_being_refinanced ?? false,
    notes: body.notes ?? null,
  };

  const { data, error } = await (sb as any)
    .from("deal_existing_debt_schedule")
    .insert(row)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, existingDebt: data });
}
