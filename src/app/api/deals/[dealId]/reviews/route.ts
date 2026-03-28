import "server-only";

/**
 * GET /api/deals/[dealId]/reviews
 *
 * Returns annual review + renewal case state.
 */

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let bankId: string;
  try { bankId = await getCurrentBankId(); } catch {
    return NextResponse.json({ ok: false, error: "No bank context" }, { status: 403 });
  }

  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data: deal } = await sb.from("deals").select("id").eq("id", dealId).eq("bank_id", bankId).maybeSingle();
  if (!deal) return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });

  try {
    const [arCases, rnCases, reqs, exceptions, outputs] = await Promise.all([
      sb.from("deal_annual_review_cases")
        .select("id, review_year, status, readiness_state, due_at, borrower_campaign_id")
        .eq("deal_id", dealId).order("review_year", { ascending: false }),
      sb.from("deal_renewal_cases")
        .select("id, target_maturity_date, status, readiness_state, due_at, borrower_campaign_id")
        .eq("deal_id", dealId).order("target_maturity_date", { ascending: false }),
      sb.from("deal_review_case_requirements")
        .select("id, case_type, case_id, requirement_code, title, description, borrower_visible, status, required, evidence_type")
        .eq("deal_id", dealId),
      sb.from("deal_review_case_exceptions")
        .select("id, case_type, case_id, exception_code, severity, status")
        .eq("deal_id", dealId).eq("status", "open"),
      sb.from("deal_review_case_outputs")
        .select("id, case_type, case_id, output_type, status, artifact_ref")
        .eq("deal_id", dealId),
    ]);

    // Count pending/exceptions per case
    const reqsByCase = new Map<string, { pending: number; underReview: number }>();
    for (const r of reqs.data ?? []) {
      const key = r.case_id;
      const entry = reqsByCase.get(key) ?? { pending: 0, underReview: 0 };
      if (r.required && (r.status === "pending" || r.status === "requested")) entry.pending++;
      if (r.required && r.status === "under_review") entry.underReview++;
      reqsByCase.set(key, entry);
    }

    const exByCase = new Map<string, number>();
    for (const e of exceptions.data ?? []) {
      exByCase.set(e.case_id, (exByCase.get(e.case_id) ?? 0) + 1);
    }

    return NextResponse.json({
      ok: true,
      annualReviewCases: (arCases.data ?? []).map((c) => ({
        id: c.id,
        reviewYear: c.review_year,
        status: c.status,
        readinessState: c.readiness_state,
        dueAt: c.due_at,
        borrowerCampaignId: c.borrower_campaign_id,
        pendingRequirementCount: reqsByCase.get(c.id)?.pending ?? 0,
        openExceptionCount: exByCase.get(c.id) ?? 0,
      })),
      renewalCases: (rnCases.data ?? []).map((c) => ({
        id: c.id,
        targetMaturityDate: c.target_maturity_date,
        status: c.status,
        readinessState: c.readiness_state,
        dueAt: c.due_at,
        borrowerCampaignId: c.borrower_campaign_id,
        pendingRequirementCount: reqsByCase.get(c.id)?.pending ?? 0,
        openExceptionCount: exByCase.get(c.id) ?? 0,
      })),
      requirements: (reqs.data ?? []).map((r) => ({
        id: r.id, caseType: r.case_type, caseId: r.case_id,
        requirementCode: r.requirement_code, title: r.title, description: r.description,
        borrowerVisible: r.borrower_visible, status: r.status, required: r.required, evidenceType: r.evidence_type,
      })),
      exceptions: (exceptions.data ?? []).map((e) => ({
        id: e.id, caseType: e.case_type, exceptionCode: e.exception_code, severity: e.severity, status: e.status,
      })),
      outputs: (outputs.data ?? []).map((o) => ({
        id: o.id, caseType: o.case_type, outputType: o.output_type, status: o.status, artifactRef: o.artifact_ref,
      })),
    });
  } catch (err) {
    console.error("[GET /api/deals/[dealId]/reviews]", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
