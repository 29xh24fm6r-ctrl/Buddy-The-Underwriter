import "server-only";

/**
 * GET /api/deals/[dealId]/post-close
 *
 * Returns the full post-close monitoring state for a deal.
 */

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveMonitoringProgramSummary } from "@/core/post-close/deriveMonitoringProgramSummary";
import { deriveMonitoringSeverity } from "@/core/post-close/deriveMonitoringSeverity";
import { deriveMonitoringBlockingParty } from "@/core/post-close/deriveMonitoringBlockingParty";
import type { MonitoringCycleStatus, MonitoringObligationType } from "@/core/post-close/types";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch {
    return NextResponse.json({ ok: false, error: "No bank context" }, { status: 403 });
  }

  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  // Verify deal
  const { data: deal } = await sb
    .from("deals")
    .select("id")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (!deal) {
    return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
  }

  try {
    const [program, obligations, cycles, exceptions, annualReview, renewalPrep] =
      await Promise.all([
        deriveMonitoringProgramSummary(dealId),
        sb
          .from("deal_monitoring_obligations")
          .select("id, obligation_type, title, cadence, status, due_day, due_month")
          .eq("deal_id", dealId)
          .order("created_at"),
        sb
          .from("deal_monitoring_cycles")
          .select("id, obligation_id, due_at, status, borrower_campaign_id, submission_received_at, review_started_at")
          .eq("deal_id", dealId)
          .order("due_at"),
        sb
          .from("deal_monitoring_exceptions")
          .select("id, exception_code, severity, status, opened_at, cycle_id, obligation_id")
          .eq("deal_id", dealId)
          .eq("status", "open")
          .order("opened_at", { ascending: false }),
        sb
          .from("deal_annual_reviews")
          .select("id, review_year, status, due_at, borrower_campaign_id")
          .eq("deal_id", dealId)
          .order("review_year", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb
          .from("deal_renewal_prep")
          .select("id, target_maturity_date, prep_start_at, status")
          .eq("deal_id", dealId)
          .order("target_maturity_date", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    // Enrich cycles with severity + blocking party
    const openExceptionCycleIds = new Set(
      (exceptions.data ?? []).map((e) => e.cycle_id).filter(Boolean),
    );

    const obligationMap = new Map(
      (obligations.data ?? []).map((o) => [o.id, o]),
    );

    // Count overdue per obligation for severity
    const overdueByObligation = new Map<string, number>();
    for (const c of cycles.data ?? []) {
      if (c.status === "overdue") {
        const count = overdueByObligation.get(c.obligation_id) ?? 0;
        overdueByObligation.set(c.obligation_id, count + 1);
      }
    }

    const enrichedCycles = (cycles.data ?? []).map((c) => {
      const ob = obligationMap.get(c.obligation_id);
      const severity = deriveMonitoringSeverity({
        cycleStatus: c.status as MonitoringCycleStatus,
        dueAt: c.due_at,
        hasOpenException: openExceptionCycleIds.has(c.id),
        isCovenantRelated: (ob as any)?.obligation_type === "covenant_certificate",
        overdueCount: overdueByObligation.get(c.obligation_id) ?? 0,
      });
      const blockingParty = deriveMonitoringBlockingParty({
        cycleStatus: c.status as MonitoringCycleStatus,
        requiresBorrowerSubmission: true,
        requiresBankerReview: true,
        submissionReceived: !!c.submission_received_at,
        reviewStarted: !!c.review_started_at,
      });
      return {
        id: c.id,
        obligationId: c.obligation_id,
        title: ob?.title ?? "Obligation",
        dueAt: c.due_at,
        status: c.status,
        severity,
        blockingParty,
        borrowerCampaignId: c.borrower_campaign_id,
      };
    });

    return NextResponse.json({
      ok: true,
      program,
      obligations: (obligations.data ?? []).map((o) => ({
        id: o.id,
        title: o.title,
        obligationType: o.obligation_type,
        cadence: o.cadence,
        status: o.status,
      })),
      cycles: enrichedCycles,
      exceptions: (exceptions.data ?? []).map((e) => ({
        id: e.id,
        exceptionCode: e.exception_code,
        severity: e.severity,
        status: e.status,
        openedAt: e.opened_at,
      })),
      annualReview: annualReview.data
        ? { status: annualReview.data.status, dueAt: annualReview.data.due_at }
        : null,
      renewalPrep: renewalPrep.data
        ? { status: renewalPrep.data.status, prepStartAt: renewalPrep.data.prep_start_at }
        : null,
    });
  } catch (err) {
    console.error("[GET /api/deals/[dealId]/post-close]", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
