import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Params = Promise<{ dealId: string }>;

export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

    const sb = supabaseAdmin();

    const { data: request } = await sb
      .from("loan_requests")
      .select("*")
      .eq("deal_id", dealId)
      .maybeSingle();

    const { data: facilities } = request
      ? await sb
          .from("loan_request_facilities")
          .select("*")
          .eq("loan_request_id", request.id)
          .order("sort_order")
      : { data: [] };

    return NextResponse.json({ ok: true, request: request ?? null, facilities: facilities ?? [] });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const sb = supabaseAdmin();

    const { data, error } = await sb
      .from("loan_requests")
      .insert({
        deal_id: dealId,
        request_name: body.request_name ?? null,
        loan_amount: body.loan_amount ?? null,
        loan_purpose: body.loan_purpose ?? null,
        loan_type: body.loan_type ?? null,
        collateral_type: body.collateral_type ?? null,
        collateral_description: body.collateral_description ?? null,
        term_months: body.term_months ?? null,
        amortization_months: body.amortization_months ?? null,
        interest_type: body.interest_type ?? null,
        rate_index: body.rate_index ?? null,
        repayment_type: body.repayment_type ?? null,
        facility_purpose: body.facility_purpose ?? null,
        occupancy_type: body.occupancy_type ?? null,
        recourse_type: body.recourse_type ?? null,
        guarantor_required: body.guarantor_required ?? false,
        guarantor_notes: body.guarantor_notes ?? null,
        requested_close_date: body.requested_close_date ?? null,
        use_of_proceeds_json: body.use_of_proceeds_json ?? null,
        covenant_notes: body.covenant_notes ?? null,
        structure_notes: body.structure_notes ?? null,
        source: body.source ?? "banker",
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select("id")
      .single();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    // Audit
    await sb.from("deal_audit_log").insert({
      deal_id: dealId,
      bank_id: access.bankId,
      actor_id: access.userId,
      event: "loan_request_created",
      payload: { loan_request_id: data.id },
    }).then(null, () => {});

    return NextResponse.json({ ok: true, loanRequestId: data.id }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const sb = supabaseAdmin();

    const updateData: Record<string, unknown> = { updated_by: access.userId, updated_at: new Date().toISOString() };
    const allowedFields = [
      "request_name", "loan_amount", "loan_purpose", "loan_type", "collateral_type",
      "collateral_description", "term_months", "amortization_months", "interest_type",
      "rate_index", "repayment_type", "facility_purpose", "occupancy_type", "recourse_type",
      "guarantor_required", "guarantor_notes", "requested_close_date", "use_of_proceeds_json",
      "covenant_notes", "structure_notes",
    ];
    for (const f of allowedFields) {
      if (body[f] !== undefined) updateData[f] = body[f];
    }

    const { error } = await sb
      .from("loan_requests")
      .update(updateData)
      .eq("deal_id", dealId);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    await sb.from("deal_audit_log").insert({
      deal_id: dealId,
      bank_id: access.bankId,
      actor_id: access.userId,
      event: "loan_request_updated",
      payload: { updated_fields: Object.keys(updateData).filter((k) => k !== "updated_by" && k !== "updated_at") },
    }).then(null, () => {});

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
