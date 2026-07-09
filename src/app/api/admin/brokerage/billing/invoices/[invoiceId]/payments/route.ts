import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/brokerage/billing/invoices/[invoiceId]/payments
 *
 * Records a payment against a finalized invoice. Payments are their own
 * table (Lago's pattern) so partial payments and multiple attempts are
 * representable without mutating the invoice row itself. amount_paid and
 * payment_status on the invoice are denormalized for fast list-page queries,
 * recomputed here from the payments table as the source of truth.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { invoiceId } = await params;
  const body = await req.json().catch(() => ({}) as any);
  const amount = Number(body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: "amount must be a positive number" }, { status: 400 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: invoice, error: fetchErr } = await sb
    .from("lender_invoices")
    .select("id, status, amount")
    .eq("id", invoiceId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (invoice.status !== "finalized" && invoice.status !== "paid") {
    return NextResponse.json(
      { ok: false, error: `cannot record payment on invoice in status "${invoice.status}"` },
      { status: 409 },
    );
  }

  const { error: payErr } = await sb.from("lender_invoice_payments").insert({
    invoice_id: invoiceId,
    amount,
    paid_at: typeof body?.paidAt === "string" ? body.paidAt : new Date().toISOString().slice(0, 10),
    method: typeof body?.method === "string" ? body.method : null,
    reference: typeof body?.reference === "string" ? body.reference : null,
    recorded_by_clerk_user_id: userId,
  });

  if (payErr) {
    return NextResponse.json({ ok: false, error: payErr.message }, { status: 500 });
  }

  const { data: payments, error: sumErr } = await sb
    .from("lender_invoice_payments")
    .select("amount")
    .eq("invoice_id", invoiceId);

  if (sumErr) {
    return NextResponse.json({ ok: false, error: sumErr.message }, { status: 500 });
  }

  const totalPaid = (payments ?? []).reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
  const newPaymentStatus =
    totalPaid >= Number(invoice.amount) ? "paid" : totalPaid > 0 ? "partially_paid" : "pending";
  const newStatus = newPaymentStatus === "paid" ? "paid" : invoice.status;

  const { data: updated, error: updateErr } = await sb
    .from("lender_invoices")
    .update({
      amount_paid: totalPaid,
      payment_status: newPaymentStatus,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .select("*")
    .single();

  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, invoice: updated });
}
