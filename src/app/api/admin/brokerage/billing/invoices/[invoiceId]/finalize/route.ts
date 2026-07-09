import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/brokerage/billing/invoices/[invoiceId]/finalize
 *
 * draft -> finalized. Assigns a sequential invoice number via
 * next_lender_invoice_number(), which takes a Postgres advisory lock scoped
 * to the tenant so two concurrent finalizations can never collide on the
 * same number (Lago's generate_billing_entity_sequential_id pattern).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { invoiceId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: invoice, error: fetchErr } = await sb
    .from("lender_invoices")
    .select("id, status, bank_id")
    .eq("id", invoiceId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (invoice.status !== "draft") {
    return NextResponse.json(
      { ok: false, error: `cannot finalize invoice in status "${invoice.status}"` },
      { status: 409 },
    );
  }

  const { data: numberResult, error: numErr } = await sb.rpc("next_lender_invoice_number", {
    p_bank_id: brokerageBankId,
  });

  if (numErr || !numberResult) {
    return NextResponse.json(
      { ok: false, error: numErr?.message ?? "could not assign invoice number" },
      { status: 500 },
    );
  }

  const { data: updated, error: updateErr } = await sb
    .from("lender_invoices")
    .update({
      status: "finalized",
      invoice_number: numberResult,
      finalized_at: new Date().toISOString(),
      issued_at: new Date().toISOString().slice(0, 10),
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
