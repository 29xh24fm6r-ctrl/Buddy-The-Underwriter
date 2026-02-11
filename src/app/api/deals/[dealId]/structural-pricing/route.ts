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
    .from("deal_structural_pricing")
    .select("*")
    .eq("deal_id", dealId)
    .order("computed_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, structuralPricing: data ?? [] });
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
  const loanRequestId = body.loan_request_id;
  if (!loanRequestId) {
    return NextResponse.json({ ok: false, error: "loan_request_id is required" }, { status: 400 });
  }

  // Load the loan request
  const sb = supabaseAdmin();
  const { data: lr, error: lrErr } = await sb
    .from("deal_loan_requests")
    .select("*")
    .eq("id", loanRequestId)
    .eq("deal_id", dealId)
    .single();

  if (lrErr || !lr) {
    return NextResponse.json({ ok: false, error: "Loan request not found" }, { status: 404 });
  }

  // Compute structural pricing
  const { computeStructuralPricing } = await import(
    "@/lib/structuralPricing/computeStructuralPricing"
  );
  const result = await computeStructuralPricing(lr as any);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({ ok: true, structuralPricing: result.data });
}
