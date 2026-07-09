import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(): Promise<{ userId: string } | NextResponse> {
  try {
    return await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const { invoiceId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: invoice, error: invErr } = await sb
    .from("lender_invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();

  if (invErr) {
    return NextResponse.json({ ok: false, error: invErr.message }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const [{ data: lineItems }, { data: payments }, { data: lender }] = await Promise.all([
    sb.from("lender_invoice_line_items").select("*").eq("invoice_id", invoiceId).order("created_at"),
    sb.from("lender_invoice_payments").select("*").eq("invoice_id", invoiceId).order("paid_at"),
    sb.from("banks").select("id, name, code").eq("id", invoice.lender_bank_id).maybeSingle(),
  ]);

  return NextResponse.json({
    ok: true,
    invoice,
    lender,
    lineItems: lineItems ?? [],
    payments: payments ?? [],
  });
}
