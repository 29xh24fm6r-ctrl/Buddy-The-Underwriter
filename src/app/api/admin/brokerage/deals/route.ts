import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let userId: string;
  try { ({ userId } = await requireBrokerageStaff()); }
  catch { return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }); }

  const body = await req.json().catch(() => ({}));
  const businessName = typeof body.businessName === "string" ? body.businessName.trim() : "";
  const borrowerName = typeof body.borrowerName === "string" ? body.borrowerName.trim() : "";
  const amount = Number(body.loanAmount);
  if (!businessName || !borrowerName) {
    return NextResponse.json({ ok: false, error: "Business and borrower names are required." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    return NextResponse.json({ ok: false, error: "Enter a valid requested loan amount." }, { status: 400 });
  }

  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const { data: borrower, error: borrowerError } = await sb.from("borrowers").insert({
    bank_id: bankId,
    legal_name: borrowerName,
    entity_type: typeof body.entityType === "string" && body.entityType ? body.entityType : null,
  }).select("id").single();
  if (borrowerError || !borrower) {
    return NextResponse.json({ ok: false, error: borrowerError?.message ?? "Could not create borrower." }, { status: 500 });
  }

  const dealId = crypto.randomUUID();
  const { error: dealError } = await sb.from("deals").insert({
    id: dealId,
    bank_id: bankId,
    borrower_id: borrower.id,
    name: businessName,
    display_name: businessName,
    borrower_name: borrowerName,
    loan_amount: amount,
    stage: "intake",
    brokerage_stage: "document_collection",
    brokerage_stage_entered_at: now,
    brokerage_stage_owner_clerk_user_id: userId,
    origin: "banker_created",
    crm_tracking_only: false,
    external_deal_source: "brokerage_self_sourced_package",
    entity_type: body.entityType || "Unknown",
    risk_score: 0,
    created_by_user_id: userId,
    created_at: now,
    updated_at: now,
  });
  if (dealError) {
    await sb.from("borrowers").delete().eq("id", borrower.id).eq("bank_id", bankId);
    return NextResponse.json({ ok: false, error: dealError.message }, { status: 500 });
  }

  await Promise.all([
    sb.from("deal_audit_log").insert({
      deal_id: dealId, bank_id: bankId, actor_id: userId, event: "admin_self_sourced_deal_created",
      payload: { borrower_id: borrower.id, business_name: businessName, loan_amount: amount },
    }),
    sb.from("deal_brokerage_stage_transitions").insert({
      bank_id: bankId, deal_id: dealId, from_stage: null, to_stage: "document_collection",
      reason: "Admin loaded a self-sourced deal package", actor_clerk_user_id: userId,
    }),
  ]);

  return NextResponse.json({ ok: true, dealId, next: `/deals/${dealId}/cockpit` }, { status: 201 });
}
