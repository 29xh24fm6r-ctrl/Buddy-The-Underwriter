import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeOrganizationRelationshipScore } from "@/lib/intelligence/relationshipScore";
import { computeReferralSourceAnalytics } from "@/lib/intelligence/referralAnalytics";
import { computeLenderPerformance } from "@/lib/intelligence/lenderAnalytics";
import { computeRevenueRollup, runRevenueReconciliation } from "@/lib/intelligence/revenue";
import { computePipelineForecast } from "@/lib/intelligence/forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/brokerage/crm/intelligence?type=<kind>&...
 * Single dispatcher route for spec sections 7.1-7.5 (relationship score,
 * referral analytics, lender performance, revenue, forecast) — mirrors
 * the query-param dispatcher pattern already used by /api/cron/crm-automation
 * (PR4) and /api/admin/brokerage/deals/[dealId]/execution/actions (PR3),
 * rather than one route file per read, to stay within the route-count
 * budget this program tracks across every PR.
 */
export async function GET(req: NextRequest) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const bankId = await getBrokerageBankId();
  const type = req.nextUrl.searchParams.get("type");

  try {
    switch (type) {
      case "relationship-score": {
        const orgId = req.nextUrl.searchParams.get("orgId");
        if (!orgId) return NextResponse.json({ ok: false, error: "orgId is required" }, { status: 400 });
        const score = await computeOrganizationRelationshipScore(bankId, orgId);
        return NextResponse.json({ ok: true, score });
      }
      case "referral-analytics": {
        const orgId = req.nextUrl.searchParams.get("orgId");
        if (!orgId) return NextResponse.json({ ok: false, error: "orgId is required" }, { status: 400 });
        const analytics = await computeReferralSourceAnalytics(bankId, orgId);
        return NextResponse.json({ ok: true, analytics });
      }
      case "lender-performance": {
        const lenderBankId = req.nextUrl.searchParams.get("lenderBankId");
        if (!lenderBankId) return NextResponse.json({ ok: false, error: "lenderBankId is required" }, { status: 400 });
        const performance = await computeLenderPerformance(bankId, lenderBankId);
        return NextResponse.json({ ok: true, performance });
      }
      case "revenue": {
        const [rollup, reconciliation] = await Promise.all([computeRevenueRollup(bankId), runRevenueReconciliation(supabaseAdmin())]);
        return NextResponse.json({ ok: true, rollup, reconciliation });
      }
      case "forecast": {
        const forecast = await computePipelineForecast(bankId);
        return NextResponse.json({ ok: true, forecast });
      }
      default:
        return NextResponse.json({ ok: false, error: "type must be one of: relationship-score, referral-analytics, lender-performance, revenue, forecast" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
