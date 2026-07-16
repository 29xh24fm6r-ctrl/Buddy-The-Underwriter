import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import {
  insertExistingDebtScheduleEntry,
  syncExistingDebtScheduleToDownstream,
} from "@/lib/financialFacts/existingDebtScheduleWriter";

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

  const result = await insertExistingDebtScheduleEntry({
    dealId,
    bankId: access.bankId ?? null,
    lenderName: body.lender_name,
    loanType: body.loan_type ?? null,
    originalAmount: body.original_amount ?? null,
    currentBalance: body.current_balance ?? null,
    interestRatePct: body.interest_rate_pct ?? null,
    maturityDate: body.maturity_date ?? null,
    monthlyPayment: body.monthly_payment ?? null,
    annualDebtService: body.annual_debt_service ?? null,
    isBeingRefinanced: body.is_being_refinanced ?? false,
    notes: body.notes ?? null,
    source: "manual_banker",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  // Non-fatal: keeps the SBA package's DSCR denominator in sync with this
  // table whenever a banker enters existing debt directly, same as the
  // Brokerage borrower-facing route does. See existingDebtScheduleWriter.ts.
  if (access.bankId) {
    await syncExistingDebtScheduleToDownstream({ dealId, bankId: access.bankId }).catch(() => {});
  }

  return NextResponse.json({ ok: true, existingDebt: result.row });
}
