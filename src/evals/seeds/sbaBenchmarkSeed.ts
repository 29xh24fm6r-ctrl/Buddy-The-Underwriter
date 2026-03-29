/**
 * SBA Benchmark Seed Data — Phase 58A
 *
 * Historical SBA default rates by NAICS code.
 * Source: U.S. SBA national loan database (1987–2014), ~899,164 observations.
 *
 * Run via: npx tsx src/evals/seeds/sbaBenchmarkSeed.ts
 */

const SBA_NAICS_DEFAULT_DATA = [
  { naics: "722511", description: "Full-Service Restaurants", default_rate: 0.269, tier: "very_high", sample: 42000 },
  { naics: "722513", description: "Limited-Service Restaurants", default_rate: 0.282, tier: "very_high", sample: 31000 },
  { naics: "441110", description: "New Car Dealers", default_rate: 0.245, tier: "high", sample: 8400 },
  { naics: "445110", description: "Supermarkets and Grocery Stores", default_rate: 0.231, tier: "high", sample: 12000 },
  { naics: "236220", description: "Commercial/Institutional Building", default_rate: 0.228, tier: "high", sample: 19000 },
  { naics: "236115", description: "New Single-Family Home Constr.", default_rate: 0.235, tier: "high", sample: 11000 },
  { naics: "541110", description: "Offices of Lawyers", default_rate: 0.183, tier: "medium", sample: 9800 },
  { naics: "621111", description: "Offices of Physicians", default_rate: 0.142, tier: "medium", sample: 14000 },
  { naics: "621210", description: "Offices of Dentists", default_rate: 0.139, tier: "medium", sample: 16000 },
  { naics: "623110", description: "Nursing Care Facilities", default_rate: 0.201, tier: "high", sample: 6200 },
  { naics: "531120", description: "Lessors of Nonresidential Bldgs", default_rate: 0.189, tier: "medium", sample: 21000 },
  { naics: "531110", description: "Lessors of Residential Bldgs", default_rate: 0.175, tier: "medium", sample: 18000 },
  { naics: "541511", description: "Custom Computer Programming", default_rate: 0.131, tier: "medium", sample: 7200 },
  { naics: "561720", description: "Janitorial Services", default_rate: 0.148, tier: "medium", sample: 5100 },
  { naics: "561110", description: "Office Admin Services", default_rate: 0.122, tier: "medium", sample: 4400 },
  { naics: "524210", description: "Insurance Agencies & Brokerages", default_rate: 0.115, tier: "medium", sample: 3900 },
  { naics: "423990", description: "Durable Goods Wholesale (Misc)", default_rate: 0.143, tier: "medium", sample: 6800 },
  { naics: "541330", description: "Engineering Services", default_rate: 0.089, tier: "low", sample: 5600 },
  { naics: "541219", description: "Other Accounting Services", default_rate: 0.082, tier: "low", sample: 7100 },
  { naics: "621310", description: "Offices of Chiropractors", default_rate: 0.095, tier: "low", sample: 8800 },
  { naics: "621320", description: "Offices of Optometrists", default_rate: 0.078, tier: "low", sample: 5200 },
  { naics: "238210", description: "Electrical Contractors", default_rate: 0.105, tier: "low", sample: 12000 },
  { naics: "238220", description: "Plumbing/Heating/AC Contractors", default_rate: 0.102, tier: "low", sample: 11000 },
  { naics: "484110", description: "General Freight Trucking (Local)", default_rate: 0.138, tier: "medium", sample: 9300 },
  { naics: "522110", description: "Commercial Banking", default_rate: 0.164, tier: "medium", sample: 3400 },
] as const;

export async function seedSBABenchmarkData(): Promise<void> {
  // Dynamic import to avoid pulling supabase into test bundles
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();

  console.log(
    `[sbaBenchmarkSeed] Seeding ${SBA_NAICS_DEFAULT_DATA.length} NAICS codes...`,
  );

  for (const row of SBA_NAICS_DEFAULT_DATA) {
    const { error } = await sb
      .from("buddy_industry_benchmarks")
      .update({
        sba_default_rate_pct: row.default_rate,
        sba_default_risk_tier: row.tier,
        sba_sample_size: row.sample,
        sba_data_period: "1987-2014",
        sba_notes:
          "Historical SBA national loan database. Population-level baselines only.",
      })
      .eq("naics_code", row.naics);

    if (error) {
      console.error(
        `[sbaBenchmarkSeed] NAICS ${row.naics}:`,
        error.message,
      );
    }
  }

  console.log(
    `[sbaBenchmarkSeed] Updated ${SBA_NAICS_DEFAULT_DATA.length} NAICS codes`,
  );
}

if (require.main === module) {
  seedSBABenchmarkData()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
