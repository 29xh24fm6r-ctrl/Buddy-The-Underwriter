import "server-only";

/**
 * POST /api/admin/reviews/process
 *
 * Background processor for annual review + renewal cases.
 * Auth: CRON_SECRET.
 */

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createAnnualReviewCase } from "@/core/reviews/createAnnualReviewCase";
import { createRenewalCase } from "@/core/reviews/createRenewalCase";
import { seedReviewRequirements } from "@/core/reviews/seedReviewRequirements";
import { carryForwardMonitoringExceptions } from "@/core/reviews/carryForwardMonitoringExceptions";
import { reconcileReviewSubmission } from "@/core/reviews/reconcileReviewSubmission";
import { createReviewBorrowerCampaign } from "@/core/reviews/createReviewBorrowerCampaign";
import { deriveReviewReadiness } from "@/core/reviews/deriveReviewReadiness";
import type { ReviewCaseType, ReviewRequirementStatus } from "@/core/reviews/types";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseAdmin();
  const stats = { casesCreated: 0, requirementsSeeded: 0, exceptionsCarried: 0, campaignsCreated: 0, readinessUpdated: 0, errors: 0 };

  try {
    // 1. Create annual review cases from seeded reviews
    const { data: seededReviews } = await sb
      .from("deal_annual_reviews")
      .select("id, deal_id, bank_id, review_year, due_at")
      .eq("status", "seeded");

    for (const ar of seededReviews ?? []) {
      try {
        const result = await createAnnualReviewCase({
          dealId: ar.deal_id, bankId: ar.bank_id, annualReviewId: ar.id,
          reviewYear: ar.review_year, dueAt: ar.due_at,
        });
        if (result.created) {
          stats.casesCreated++;
          await sb.from("deal_annual_reviews").update({ status: "requested" }).eq("id", ar.id);
        }
        if (result.ok && result.caseId) {
          const seedResult = await seedReviewRequirements({ dealId: ar.deal_id, bankId: ar.bank_id, caseType: "annual_review", caseId: result.caseId });
          stats.requirementsSeeded += seedResult.seededCount;
          const cfResult = await carryForwardMonitoringExceptions({ dealId: ar.deal_id, bankId: ar.bank_id, caseType: "annual_review", caseId: result.caseId });
          stats.exceptionsCarried += cfResult.carriedCount;
        }
      } catch { stats.errors++; }
    }

    // 2. Create renewal cases from seeded prep
    const { data: seededPreps } = await sb
      .from("deal_renewal_prep")
      .select("id, deal_id, bank_id, target_maturity_date, prep_start_at")
      .eq("status", "seeded");

    for (const rp of seededPreps ?? []) {
      try {
        const result = await createRenewalCase({
          dealId: rp.deal_id, bankId: rp.bank_id, renewalPrepId: rp.id,
          targetMaturityDate: rp.target_maturity_date, dueAt: rp.target_maturity_date,
        });
        if (result.created) {
          stats.casesCreated++;
          await sb.from("deal_renewal_prep").update({ status: "in_progress" }).eq("id", rp.id);
        }
        if (result.ok && result.caseId) {
          const seedResult = await seedReviewRequirements({ dealId: rp.deal_id, bankId: rp.bank_id, caseType: "renewal", caseId: result.caseId });
          stats.requirementsSeeded += seedResult.seededCount;
          const cfResult = await carryForwardMonitoringExceptions({ dealId: rp.deal_id, bankId: rp.bank_id, caseType: "renewal", caseId: result.caseId });
          stats.exceptionsCarried += cfResult.carriedCount;
        }
      } catch { stats.errors++; }
    }

    // 3. Create borrower campaigns for cases with pending borrower requirements
    const allCases = [
      ...((await sb.from("deal_annual_review_cases").select("id, deal_id, bank_id").in("status", ["seeded", "requesting", "collecting"])).data ?? []).map((c) => ({ ...c, caseType: "annual_review" as ReviewCaseType })),
      ...((await sb.from("deal_renewal_cases").select("id, deal_id, bank_id").in("status", ["seeded", "requesting", "collecting"])).data ?? []).map((c) => ({ ...c, caseType: "renewal" as ReviewCaseType })),
    ];

    for (const c of allCases) {
      try {
        // Reconcile existing evidence
        await reconcileReviewSubmission({ dealId: c.deal_id, caseType: c.caseType, caseId: c.id });

        // Get pending borrower-visible requirements for campaign
        const { data: pendingReqs } = await sb
          .from("deal_review_case_requirements")
          .select("id, requirement_code, title, description, borrower_visible, status, required, evidence_type")
          .eq("case_id", c.id).eq("case_type", c.caseType)
          .eq("borrower_visible", true).eq("status", "pending");

        if (pendingReqs && pendingReqs.length > 0) {
          const campResult = await createReviewBorrowerCampaign({
            dealId: c.deal_id, bankId: c.bank_id, caseType: c.caseType, caseId: c.id,
            requirements: pendingReqs.map((r) => ({
              id: r.id, requirementCode: r.requirement_code, title: r.title,
              description: r.description, borrowerVisible: r.borrower_visible,
              status: r.status as any, required: r.required, evidenceType: r.evidence_type,
            })),
            createdBy: "system",
          });
          if (campResult.campaignId) {
            const caseTable = c.caseType === "annual_review" ? "deal_annual_review_cases" : "deal_renewal_cases";
            await sb.from(caseTable).update({ borrower_campaign_id: campResult.campaignId, status: "requesting" }).eq("id", c.id);
            stats.campaignsCreated++;
          }
        }

        // Derive and update readiness
        const { data: allReqs } = await sb
          .from("deal_review_case_requirements")
          .select("required, status, borrower_visible")
          .eq("case_id", c.id).eq("case_type", c.caseType);
        const { count: openEx } = await sb
          .from("deal_review_case_exceptions")
          .select("id", { count: "exact", head: true })
          .eq("case_id", c.id).eq("case_type", c.caseType).eq("status", "open");

        const readiness = deriveReviewReadiness({
          requirements: (allReqs ?? []).map((r) => ({
            required: r.required, status: r.status as ReviewRequirementStatus, borrowerVisible: r.borrower_visible,
          })),
          openExceptionCount: openEx ?? 0,
        });

        const caseTable = c.caseType === "annual_review" ? "deal_annual_review_cases" : "deal_renewal_cases";
        await sb.from(caseTable).update({ readiness_state: readiness }).eq("id", c.id);
        stats.readinessUpdated++;
      } catch { stats.errors++; }
    }

    return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), ...stats });
  } catch (err) {
    console.error("[POST /api/admin/reviews/process]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
