import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { initializeCommissionSplitsForDeal, listCommissionSplitsForDeal, recalculateCommissionSplitAmounts, updateCommissionSplitStatus } from "@/lib/intelligence/commissionSplits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET lists a deal's commission splits (spec section 7.4). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { dealId } = await params;
  const bankId = await getBrokerageBankId();
  const splits = await listCommissionSplitsForDeal(bankId, dealId);
  return NextResponse.json({ ok: true, splits });
}

/**
 * POST { action: "initialize" } derives splits from deal_source_attribution /
 * deal_participants (idempotent).
 * POST { action: "recalculate" } recomputes amount_cents from the deal's
 * current fee-ledger amount.
 * PATCH { splitId, status } updates one split's payment status.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { dealId } = await params;
  const bankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  try {
    if (body?.action === "initialize") {
      const result = await initializeCommissionSplitsForDeal(bankId, dealId);
      return NextResponse.json({ ok: true, ...result });
    }
    if (body?.action === "recalculate") {
      const result = await recalculateCommissionSplitAmounts(bankId, dealId);
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, error: "action must be initialize or recalculate" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ dealId: string }> }) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  await params;
  const bankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  if (typeof body?.splitId !== "string" || !["estimated", "confirmed", "paid"].includes(body?.status)) {
    return NextResponse.json({ ok: false, error: "splitId and a valid status are required" }, { status: 400 });
  }
  try {
    await updateCommissionSplitStatus(bankId, body.splitId, body.status);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
