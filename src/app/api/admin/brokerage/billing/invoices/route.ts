import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/billing/invoices — lender commission invoices.
 *
 * Lago-inspired billing core (lender_invoices / lender_invoice_line_items /
 * lender_invoice_payments), simplified for a referral-fee-on-funded-loan
 * business — see migration brokerage_billing_lender_invoices for schema
 * notes on what was kept vs. deliberately left out.
 *
 * GET  -> list invoices (with lender name + line item count)
 * POST -> create a draft invoice with line items
 */

async function gate(): Promise<{ userId: string } | NextResponse> {
  try {
    return await requireSuperAdmin();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
}

export async function GET() {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: invoices, error } = await sb
    .from("lender_invoices")
    .select("*")
    .eq("bank_id", brokerageBankId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const lenderIds = Array.from(new Set((invoices ?? []).map((i: any) => i.lender_bank_id)));
  const { data: lenders } = lenderIds.length
    ? await sb.from("banks").select("id, name, code").in("id", lenderIds)
    : { data: [] };
  const lenderById = new Map((lenders ?? []).map((l: any) => [l.id, l]));

  const result = (invoices ?? []).map((inv: any) => ({
    ...inv,
    lender: lenderById.get(inv.lender_bank_id) ?? null,
  }));

  return NextResponse.json({ ok: true, invoices: result });
}

export async function POST(req: NextRequest) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;
  const { userId } = gated;

  const body = await req.json().catch(() => ({}) as any);
  const lenderBankId = typeof body?.lenderBankId === "string" ? body.lenderBankId : "";
  const lineItems = Array.isArray(body?.lineItems) ? body.lineItems : [];

  if (!lenderBankId) {
    return NextResponse.json({ ok: false, error: "lenderBankId is required" }, { status: 400 });
  }
  if (lineItems.length === 0) {
    return NextResponse.json({ ok: false, error: "at least one line item is required" }, { status: 400 });
  }

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const total = lineItems.reduce((sum: number, li: any) => {
    const n = Number(li.amount);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  const { data: invoice, error: invErr } = await sb
    .from("lender_invoices")
    .insert({
      bank_id: brokerageBankId,
      lender_bank_id: lenderBankId,
      status: "draft",
      amount: total,
      memo: typeof body?.memo === "string" ? body.memo : null,
      created_by_clerk_user_id: userId,
    })
    .select("*")
    .single();

  if (invErr || !invoice) {
    return NextResponse.json({ ok: false, error: invErr?.message ?? "insert failed" }, { status: 500 });
  }

  const rows = lineItems.map((li: any) => ({
    invoice_id: invoice.id,
    deal_id: li.dealId ?? null,
    description: String(li.description ?? "Referral fee"),
    amount: Number(li.amount) || 0,
  }));

  const { error: liErr } = await sb.from("lender_invoice_line_items").insert(rows);
  if (liErr) {
    // Roll back the invoice so we don't leave an orphaned draft with no line items.
    await sb.from("lender_invoices").delete().eq("id", invoice.id);
    return NextResponse.json({ ok: false, error: liErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, invoice });
}
