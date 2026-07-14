import "server-only";

/**
 * GET/POST/DELETE /api/brokerage/deals/[dealId]/existing-debt
 *
 * Borrower-facing existing-business-debt capture for Brokerage.
 * SPEC-BROKERAGE-SBA-READY-V1 debt-schedule-wiring follow-up: before this
 * route, no Brokerage borrower had any way — conversational, Plaid-driven,
 * or manual — to get their existing business debt into the system (see
 * docs/archive/brokerage-sba-ready-v1/T0-findings.md item 3 and the
 * dedicated follow-up spec). Brokerage doesn't have a live Plaid connection
 * yet, so this is the manual-entry path; writes land in the same
 * deal_existing_debt_schedule table the banker-facing route
 * (/api/deals/[dealId]/existing-debt) and a future Plaid auto-builder will
 * both use (see existingDebtSchedule.ts's debtScheduleEntryToRow).
 *
 * Session must match the URL's dealId per the same 404-not-403 rule as
 * every other brokerage borrower route (see seal-status/route.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import {
  listExistingDebtScheduleEntries,
  insertExistingDebtScheduleEntry,
  deleteExistingDebtScheduleEntry,
  syncExistingDebtScheduleToDownstream,
} from "@/lib/financialFacts/existingDebtScheduleWriter";

export const runtime = "nodejs";
export const maxDuration = 30;

async function requireSession(dealId: string) {
  const session = await getBorrowerSession();
  if (!session || session.deal_id !== dealId) return null;
  return session;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  const session = await requireSession(dealId);
  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  try {
    const entries = await listExistingDebtScheduleEntries(dealId);
    return NextResponse.json({ ok: true, entries });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  const session = await requireSession(dealId);
  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // "I have no other business debt" affirmative confirmation — writes
  // ADS=0 explicitly rather than leaving the DSCR denominator silently
  // incomplete. No row is created; the confirmation itself is the signal.
  if (body?.confirmNoDebt === true) {
    const sync = await syncExistingDebtScheduleToDownstream({
      dealId,
      bankId: session.bank_id,
      confirmNoDebt: true,
    });
    return NextResponse.json({ ok: sync.ok, confirmedNoDebt: true, sync });
  }

  const result = await insertExistingDebtScheduleEntry({
    dealId,
    bankId: session.bank_id,
    lenderName: body.lenderName ?? body.lender_name,
    loanType: body.loanType ?? body.loan_type ?? null,
    originalAmount: body.originalAmount ?? body.original_amount ?? null,
    currentBalance: body.currentBalance ?? body.current_balance ?? null,
    interestRatePct: body.interestRatePct ?? body.interest_rate_pct ?? null,
    maturityDate: body.maturityDate ?? body.maturity_date ?? null,
    monthlyPayment: body.monthlyPayment ?? body.monthly_payment ?? null,
    annualDebtService: body.annualDebtService ?? body.annual_debt_service ?? null,
    isBeingRefinanced: body.isBeingRefinanced ?? body.is_being_refinanced ?? false,
    notes: body.notes ?? null,
    source: "manual_borrower",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const sync = await syncExistingDebtScheduleToDownstream({
    dealId,
    bankId: session.bank_id,
  });

  return NextResponse.json({ ok: true, entry: result.row, sync });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await params;
  const session = await requireSession(dealId);
  if (!session) return NextResponse.json({ ok: false }, { status: 404 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  const result = await deleteExistingDebtScheduleEntry({ id, dealId });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const sync = await syncExistingDebtScheduleToDownstream({
    dealId,
    bankId: session.bank_id,
  });

  return NextResponse.json({ ok: true, sync });
}
