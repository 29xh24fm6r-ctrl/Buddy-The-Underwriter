/**
 * SBA Eligibility Check API
 * Evaluate deal against SBA policy rules
 */

import { NextRequest, NextResponse } from "next/server";
import { evaluateSBAEligibility, formatEligibilityReport } from "@/lib/sba/eligibility";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params;
    const body = await req.json();
    
    const { program = "7A", dealData } = body;

    if (!dealData) {
      return NextResponse.json(
        { ok: false, error: "Missing 'dealData'" },
        { status: 400 }
      );
    }

    // Run eligibility evaluation
    const report = await evaluateSBAEligibility({
      dealId,
      program,
      dealData,
    });

    const formatted = formatEligibilityReport(report);

    return NextResponse.json({
      ok: true,
      overall_eligible: report.overall_eligible,
      hard_stops: report.hard_stops.length,
      mitigations_required: report.mitigations_required.length,
      advisories: report.advisories.length,
      passed_rules: report.passed_rules.length,
      report: formatted,
      details: report,
    });
  } catch (error: any) {
    console.error("SBA eligibility error:", error);
    return NextResponse.json(
      { ok: false, error: error.message || "Unknown error" },
      { status: 500 }
    );
  }
}
