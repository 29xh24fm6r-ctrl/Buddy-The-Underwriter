import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateSBAPackage } from "@/lib/sba/sbaPackageOrchestrator";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const maxDuration = 120; // Gemini narrative calls can be slow

/**
 * T-85-PROBE-1 — SBA forward model canary.
 *
 * Admin-gated POST that seeds a test buddy_sba_assumptions row for a known
 * canary deal, invokes generateSBAPackage(), returns diagnostic output, and
 * cleans up the seed row (unless body.keep === true).
 *
 * Purpose: validate that the SBA engine produces non-zero, type-safe output
 * with production data shapes before Phase 85-BPG builds on top of it.
 */
export async function POST(req: NextRequest) {
  // Gate: admin Clerk userId OR CRON_SECRET header
  const { userId } = await clerkAuth().catch(() => ({ userId: null as string | null }));
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers.get("x-cron-secret");
  const adminUserIds = (process.env.ADMIN_CLERK_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const isAdmin =
    (userId && adminUserIds.includes(userId)) ||
    (cronSecret && headerSecret === cronSecret);

  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const keepResult = body?.keep === true;

  const sb = supabaseAdmin();

  const CANARY_DEAL_ID = "0279ed32-c25c-4919-b231-5790050331dd";

  const { data: deal } = await sb
    .from("deals")
    .select("id, name, loan_amount, deal_type")
    .eq("id", CANARY_DEAL_ID)
    .single();

  if (!deal) {
    return NextResponse.json(
      { error: `Canary deal ${CANARY_DEAL_ID} not found` },
      { status: 404 },
    );
  }

  // Clean up any stale seed from previous runs
  await sb
    .from("buddy_sba_assumptions")
    .delete()
    .eq("deal_id", CANARY_DEAL_ID);

  // Seed buddy_sba_assumptions with canary-realistic data sourced from the
  // deal's actual financial facts.
  const seedAssumptions = {
    deal_id: CANARY_DEAL_ID,
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
    revenue_streams: [
      {
        id: "canary_stream_1",
        name: "Primary Revenue",
        baseAnnualRevenue: 1360479,
        growthRateYear1: 0.08,
        growthRateYear2: 0.06,
        growthRateYear3: 0.05,
        pricingModel: "flat",
        seasonalityProfile: null,
      },
    ],
    cost_assumptions: {
      cogsPercentYear1: 0.29,
      cogsPercentYear2: 0.29,
      cogsPercentYear3: 0.28,
      fixedCostCategories: [
        { name: "Salaries & Wages", annualAmount: 228574, escalationPctPerYear: 0.03 },
        { name: "Insurance", annualAmount: 37315, escalationPctPerYear: 0.02 },
        { name: "Repairs & Maintenance", annualAmount: 273786, escalationPctPerYear: 0.02 },
      ],
      plannedHires: [
        { role: "Assistant Manager", startMonth: 4, annualSalary: 52000 },
      ],
      plannedCapex: [
        { description: "Equipment upgrade", amount: 75000, year: 1 },
      ],
    },
    working_capital: {
      targetDSO: 30,
      targetDPO: 45,
      inventoryTurns: null,
    },
    loan_impact: {
      loanAmount: 500000,
      termMonths: 120,
      interestRate: 0.0725,
      existingDebt: [],
      revenueImpactStartMonth: 3,
      revenueImpactPct: 0.05,
      revenueImpactDescription: "Equipment upgrade increases production capacity",
    },
    management_team: [
      {
        name: "Test Borrower",
        title: "Managing Member",
        ownershipPct: 100,
        yearsInIndustry: 15,
        bio: "Experienced operator with 15 years in property management and commercial real estate operations. Previously managed a portfolio of 50+ commercial units.",
      },
    ],
  };

  const { data: seeded, error: seedError } = await sb
    .from("buddy_sba_assumptions")
    .insert(seedAssumptions)
    .select("id")
    .single();

  if (seedError || !seeded) {
    return NextResponse.json(
      {
        error: "Failed to seed assumptions",
        detail: seedError?.message,
        hint: (seedError as any)?.hint,
        code: (seedError as any)?.code,
      },
      { status: 500 },
    );
  }

  const seedId = seeded.id;

  // Run the engine
  let result: Awaited<ReturnType<typeof generateSBAPackage>>;
  try {
    result = await generateSBAPackage(CANARY_DEAL_ID);
  } catch (err: any) {
    await sb.from("buddy_sba_assumptions").delete().eq("id", seedId);
    return NextResponse.json(
      {
        error: "Engine threw",
        message: err?.message ?? "Unknown",
        stack: String(err?.stack ?? "").split("\n").slice(0, 8),
      },
      { status: 500 },
    );
  }

  // Collect diagnostics
  let diagnostics: Record<string, unknown> = { result };

  if (result.ok) {
    const { data: pkg } = await sb
      .from("buddy_sba_packages")
      .select("*")
      .eq("id", result.packageId)
      .single();

    if (pkg) {
      const annual = pkg.projections_annual as any[] | null;
      const sensitivity = pkg.sensitivity_scenarios as any[] | null;
      const breakEven = pkg.break_even as any | null;

      const sanity = {
        year1_revenue: annual?.[0]?.revenue ?? null,
        year1_dscr: annual?.[0]?.dscr ?? null,
        year2_dscr: annual?.[1]?.dscr ?? null,
        year3_dscr: annual?.[2]?.dscr ?? null,
        break_even_revenue: breakEven?.breakEvenRevenue ?? null,
        margin_of_safety_pct: breakEven?.marginOfSafetyPct ?? null,
        sensitivity_count: sensitivity?.length ?? 0,
        downside_passes_sba:
          sensitivity?.find((s: any) => s.name === "downside")?.passesSBAThreshold ?? null,
        narrative_length: (pkg.business_overview_narrative ?? "").length,
        sensitivity_narrative_length: (pkg.sensitivity_narrative ?? "").length,
        pdf_url: pkg.pdf_url ?? null,
        sba_guarantee_pct: pkg.sba_guarantee_pct ?? null,
        sba_guarantee_amount: pkg.sba_guarantee_amount ?? null,
      };

      const passesAllChecks =
        (sanity.year1_revenue ?? 0) > 0 &&
        (sanity.year1_dscr ?? 0) > 0 &&
        (sanity.year1_dscr ?? 0) < 99 &&
        (sanity.break_even_revenue ?? 0) > 0 &&
        (sanity.sensitivity_count ?? 0) === 3 &&
        (sanity.narrative_length ?? 0) > 50;

      diagnostics = { result, sanity, passesAllChecks };

      if (!keepResult) {
        await sb.from("buddy_sba_packages").delete().eq("id", result.packageId);
      }
    }
  }

  if (!keepResult) {
    await sb.from("buddy_sba_assumptions").delete().eq("id", seedId);
  }

  return NextResponse.json({
    probe: "T-85-PROBE-1",
    canaryDealId: CANARY_DEAL_ID,
    dealName: deal.name,
    seedAssumptionsId: seedId,
    kept: keepResult,
    ...diagnostics,
  });
}
