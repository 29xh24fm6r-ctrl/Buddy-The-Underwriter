import "server-only";
import { NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { reconcileDeal } from "@/lib/reconciliation/dealReconciliator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const summary = await reconcileDeal(dealId);

  return NextResponse.json({
    ok: true,
    reconStatus: summary.overallStatus,
    checksRun: summary.checksRun,
    checksPassed: summary.checksPassed,
    checksFailed: summary.checksFailed,
    hardFailures: summary.hardFailures,
    softFlags: summary.softFlags,
    reconciledAt: summary.reconciledAt,
  });
}

// GET — returns current reconciliation result without re-running
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("deal_reconciliation_results")
    .select(
      "overall_status, checks_run, checks_passed, checks_failed, hard_failures, soft_flags, reconciled_at",
    )
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ ok: true, reconStatus: null, reconciledAt: null });
  }

  return NextResponse.json({
    ok: true,
    reconStatus: data.overall_status,
    checksRun: data.checks_run,
    checksPassed: data.checks_passed,
    checksFailed: data.checks_failed,
    hardFailures: data.hard_failures,
    softFlags: data.soft_flags,
    reconciledAt: data.reconciled_at,
  });
}
