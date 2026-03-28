import "server-only";

/**
 * POST /api/admin/post-close/process
 *
 * Background processor for post-close monitoring.
 * Auth: Bearer token (CRON_SECRET).
 *
 * Responsibilities:
 * 1. Seed monitoring programs for newly closed deals
 * 2. Seed obligations from covenants/reporting
 * 3. Generate cycles in lookahead window
 * 4. Mark overdue cycles
 * 5. Open exceptions for overdue items
 * 6. Seed annual reviews
 * 7. Seed renewal prep
 */

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createMonitoringProgram } from "@/core/post-close/createMonitoringProgram";
import { seedMonitoringObligations } from "@/core/post-close/seedMonitoringObligations";
import { generateMonitoringCycles } from "@/core/post-close/generateMonitoringCycles";
import { openMonitoringException } from "@/core/post-close/openMonitoringException";
import { seedAnnualReview } from "@/core/post-close/seedAnnualReview";
import { seedRenewalPrep } from "@/core/post-close/seedRenewalPrep";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const stats = {
    programsCreated: 0,
    obligationsSeeded: 0,
    cyclesGenerated: 0,
    exceptionsOpened: 0,
    annualReviewsSeeded: 0,
    renewalPrepsSeeded: 0,
    errors: 0,
  };

  try {
    // 1. Find closed deals without a monitoring program
    const { data: closedDeals } = await sb
      .from("deals")
      .select("id, bank_id, closed_at")
      .not("closed_at", "is", null)
      .is("archived_at", null);

    for (const deal of closedDeals ?? []) {
      try {
        // Seed program
        const programResult = await createMonitoringProgram({
          dealId: deal.id,
          bankId: deal.bank_id,
          loanClosedAt: deal.closed_at,
          createdBy: "system",
        });

        if (programResult.created) stats.programsCreated++;

        if (programResult.ok && programResult.programId) {
          // Seed obligations
          const obResult = await seedMonitoringObligations({
            dealId: deal.id,
            bankId: deal.bank_id,
            programId: programResult.programId,
          });
          stats.obligationsSeeded += obResult.seededCount;

          // Generate cycles
          const cycleResult = await generateMonitoringCycles({
            dealId: deal.id,
            bankId: deal.bank_id,
          });
          stats.cyclesGenerated += cycleResult.generatedCount;
        }

        // Open exceptions for overdue cycles
        const { data: overdueCycles } = await sb
          .from("deal_monitoring_cycles")
          .select("id, obligation_id")
          .eq("deal_id", deal.id)
          .eq("status", "overdue");

        for (const cycle of overdueCycles ?? []) {
          const exResult = await openMonitoringException({
            dealId: deal.id,
            bankId: deal.bank_id,
            cycleId: cycle.id,
            obligationId: cycle.obligation_id,
            exceptionCode: "reporting_overdue",
            severity: "urgent",
            openedBy: "system",
          });
          if (exResult.created) stats.exceptionsOpened++;
        }

        // Seed annual review
        const { data: program } = await sb
          .from("deal_monitoring_programs")
          .select("next_review_due_at")
          .eq("deal_id", deal.id)
          .maybeSingle();

        if (program?.next_review_due_at) {
          const arResult = await seedAnnualReview({
            dealId: deal.id,
            bankId: deal.bank_id,
            nextReviewDueAt: program.next_review_due_at,
          });
          if (arResult.created) stats.annualReviewsSeeded++;
        }

        // Seed renewal prep (check for maturity date on loan request)
        const { data: loanReq } = await sb
          .from("loan_requests")
          .select("maturity_date")
          .eq("deal_id", deal.id)
          .not("maturity_date", "is", null)
          .limit(1)
          .maybeSingle();

        if (loanReq?.maturity_date) {
          const rpResult = await seedRenewalPrep({
            dealId: deal.id,
            bankId: deal.bank_id,
            maturityDate: loanReq.maturity_date,
          });
          if (rpResult.created) stats.renewalPrepsSeeded++;
        }
      } catch (err) {
        console.error(`[post-close/process] Error for deal ${deal.id}:`, err);
        stats.errors++;
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...stats,
    });
  } catch (err) {
    console.error("[POST /api/admin/post-close/process]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
