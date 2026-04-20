#!/usr/bin/env tsx
/**
 * T-85-PROBE-1 — SBA forward model canary (local runner).
 *
 * Drives the same logic as POST /api/admin/sba-canary/route.ts from a local
 * shell so we can validate the engine without waiting for Vercel deploy.
 *
 * Same pattern as scripts/phase-84-t02-reclassify-probe.ts and
 * scripts/phase-84-t04-extraction-probe.ts — uses the server-only shim
 * preload so tsx can import modules gated by `import "server-only"`.
 *
 * Usage:
 *   NODE_OPTIONS="--require=./scripts/preload-server-only-shim.cjs" \
 *     npx tsx scripts/t85-probe1-canary.ts [--keep]
 *
 * Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *               GEMINI_API_KEY (or Vertex auth for narrative generation).
 *
 * Local runtime limitation: Gemini narrative generation uses VertexAI WIF
 * auth which needs a Vercel OIDC token. Expect narrative length 0 locally.
 * Production (Vercel runtime) will exercise the success path.
 */
import { config as loadEnv } from "dotenv";
import { resolve } from "path";

loadEnv({ path: resolve(process.cwd(), ".env") });
loadEnv({ path: resolve(process.cwd(), ".env.local"), override: true });

import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateSBAPackage } from "@/lib/sba/sbaPackageOrchestrator";

const CANARY_DEAL_ID = "0279ed32-c25c-4919-b231-5790050331dd";
const keepResult = process.argv.includes("--keep");

async function main() {
  for (const k of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (!process.env[k]) {
      console.error(`Missing env: ${k}`);
      process.exit(2);
    }
  }

  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("id, name, loan_amount, deal_type")
    .eq("id", CANARY_DEAL_ID)
    .single();

  if (!deal) {
    console.error(`Canary deal ${CANARY_DEAL_ID} not found`);
    process.exit(1);
  }

  console.log(`[probe] Canary deal: ${deal.name} (deal_type=${deal.deal_type})`);

  // Clean up any stale seed from previous runs
  await sb
    .from("buddy_sba_assumptions")
    .delete()
    .eq("deal_id", CANARY_DEAL_ID);

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
    working_capital: { targetDSO: 30, targetDPO: 45, inventoryTurns: null },
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
        bio: "Experienced operator with 15 years in property management and commercial real estate operations.",
      },
    ],
  };

  const { data: seeded, error: seedError } = await sb
    .from("buddy_sba_assumptions")
    .insert(seedAssumptions)
    .select("id")
    .single();

  if (seedError || !seeded) {
    console.error("[probe] Seed failed:", seedError);
    process.exit(1);
  }

  console.log(`[probe] Seeded assumptions: ${seeded.id}`);
  console.log(`[probe] Calling generateSBAPackage(${CANARY_DEAL_ID})...`);

  const started = Date.now();
  let result: Awaited<ReturnType<typeof generateSBAPackage>>;
  try {
    result = await generateSBAPackage(CANARY_DEAL_ID);
    console.log(`[probe] Engine returned in ${Date.now() - started}ms`);
  } catch (err: any) {
    console.error(`[probe] Engine THREW in ${Date.now() - started}ms:`, err?.message);
    console.error(err?.stack);
    await sb.from("buddy_sba_assumptions").delete().eq("id", seeded.id);
    process.exit(1);
  }

  console.log("[probe] result:", JSON.stringify(result, null, 2));

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
        (sanity.sensitivity_count ?? 0) === 3;

      console.log("\n[probe] ─── SANITY CHECKS ───");
      console.log(JSON.stringify(sanity, null, 2));
      console.log(`\n[probe] passesAllChecks: ${passesAllChecks}`);
      console.log(`[probe] narrative_length: ${sanity.narrative_length} ${
        sanity.narrative_length > 50 ? "✓" : "(local Vertex auth expected to fail — OK)"
      }`);

      if (!keepResult) {
        await sb.from("buddy_sba_packages").delete().eq("id", result.packageId);
        console.log(`[probe] Cleaned up package ${result.packageId}`);
      } else {
        console.log(`[probe] Package kept: ${result.packageId}`);
      }
    }
  }

  if (!keepResult) {
    await sb.from("buddy_sba_assumptions").delete().eq("id", seeded.id);
    console.log(`[probe] Cleaned up seed ${seeded.id}`);
  } else {
    console.log(`[probe] Seed kept: ${seeded.id}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
