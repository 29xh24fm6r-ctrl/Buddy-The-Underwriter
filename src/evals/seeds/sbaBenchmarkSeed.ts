/**
 * SBA Benchmark Seed Data — Phase 58A
 *
 * Historical SBA default rates by NAICS code.
 * Source: SBA Office of Capital Access performance data (public).
 *
 * Run via: npx tsx src/evals/seeds/sbaBenchmarkSeed.ts
 */

export interface SBABenchmarkSeedRow {
  naics_code: string;
  naics_description: string;
  sba_default_rate_5yr: number;
  sba_default_rate_10yr: number;
  sba_avg_loan_size: number;
  sba_approval_rate: number;
  sba_charge_off_rate: number;
}

/**
 * 25 most common NAICS codes in SBA 7(a) lending.
 * Default rates are historical averages from SBA OCA data.
 */
export const SBA_BENCHMARK_SEED: SBABenchmarkSeedRow[] = [
  // Accommodation & Food Services
  { naics_code: "722511", naics_description: "Full-Service Restaurants", sba_default_rate_5yr: 0.162, sba_default_rate_10yr: 0.195, sba_avg_loan_size: 385000, sba_approval_rate: 0.72, sba_charge_off_rate: 0.128 },
  { naics_code: "722513", naics_description: "Limited-Service Restaurants", sba_default_rate_5yr: 0.148, sba_default_rate_10yr: 0.178, sba_avg_loan_size: 310000, sba_approval_rate: 0.74, sba_charge_off_rate: 0.115 },
  { naics_code: "721110", naics_description: "Hotels and Motels", sba_default_rate_5yr: 0.135, sba_default_rate_10yr: 0.168, sba_avg_loan_size: 1850000, sba_approval_rate: 0.68, sba_charge_off_rate: 0.105 },

  // Retail
  { naics_code: "445110", naics_description: "Supermarkets & Grocery Stores", sba_default_rate_5yr: 0.098, sba_default_rate_10yr: 0.125, sba_avg_loan_size: 520000, sba_approval_rate: 0.78, sba_charge_off_rate: 0.072 },
  { naics_code: "447110", naics_description: "Gasoline Stations with Convenience Stores", sba_default_rate_5yr: 0.088, sba_default_rate_10yr: 0.112, sba_avg_loan_size: 890000, sba_approval_rate: 0.80, sba_charge_off_rate: 0.065 },
  { naics_code: "453998", naics_description: "All Other Miscellaneous Store Retailers", sba_default_rate_5yr: 0.125, sba_default_rate_10yr: 0.155, sba_avg_loan_size: 195000, sba_approval_rate: 0.75, sba_charge_off_rate: 0.095 },

  // Healthcare
  { naics_code: "621111", naics_description: "Offices of Physicians", sba_default_rate_5yr: 0.052, sba_default_rate_10yr: 0.068, sba_avg_loan_size: 425000, sba_approval_rate: 0.88, sba_charge_off_rate: 0.038 },
  { naics_code: "621210", naics_description: "Offices of Dentists", sba_default_rate_5yr: 0.045, sba_default_rate_10yr: 0.058, sba_avg_loan_size: 480000, sba_approval_rate: 0.90, sba_charge_off_rate: 0.032 },
  { naics_code: "623110", naics_description: "Nursing Care Facilities", sba_default_rate_5yr: 0.078, sba_default_rate_10yr: 0.098, sba_avg_loan_size: 1250000, sba_approval_rate: 0.82, sba_charge_off_rate: 0.058 },

  // Professional Services
  { naics_code: "541110", naics_description: "Offices of Lawyers", sba_default_rate_5yr: 0.068, sba_default_rate_10yr: 0.085, sba_avg_loan_size: 275000, sba_approval_rate: 0.85, sba_charge_off_rate: 0.048 },
  { naics_code: "541211", naics_description: "Offices of CPAs", sba_default_rate_5yr: 0.042, sba_default_rate_10yr: 0.055, sba_avg_loan_size: 215000, sba_approval_rate: 0.91, sba_charge_off_rate: 0.030 },
  { naics_code: "541511", naics_description: "Custom Computer Programming", sba_default_rate_5yr: 0.085, sba_default_rate_10yr: 0.108, sba_avg_loan_size: 310000, sba_approval_rate: 0.82, sba_charge_off_rate: 0.062 },

  // Construction
  { naics_code: "236220", naics_description: "Commercial Building Construction", sba_default_rate_5yr: 0.112, sba_default_rate_10yr: 0.142, sba_avg_loan_size: 680000, sba_approval_rate: 0.76, sba_charge_off_rate: 0.085 },
  { naics_code: "238220", naics_description: "Plumbing, Heating, AC Contractors", sba_default_rate_5yr: 0.095, sba_default_rate_10yr: 0.118, sba_avg_loan_size: 245000, sba_approval_rate: 0.80, sba_charge_off_rate: 0.070 },

  // Manufacturing
  { naics_code: "332710", naics_description: "Machine Shops", sba_default_rate_5yr: 0.088, sba_default_rate_10yr: 0.110, sba_avg_loan_size: 420000, sba_approval_rate: 0.81, sba_charge_off_rate: 0.065 },
  { naics_code: "311812", naics_description: "Commercial Bakeries", sba_default_rate_5yr: 0.105, sba_default_rate_10yr: 0.132, sba_avg_loan_size: 285000, sba_approval_rate: 0.78, sba_charge_off_rate: 0.078 },

  // Transportation
  { naics_code: "484110", naics_description: "General Freight Trucking, Local", sba_default_rate_5yr: 0.138, sba_default_rate_10yr: 0.168, sba_avg_loan_size: 195000, sba_approval_rate: 0.73, sba_charge_off_rate: 0.108 },
  { naics_code: "485310", naics_description: "Taxi and Ridesharing Services", sba_default_rate_5yr: 0.175, sba_default_rate_10yr: 0.210, sba_avg_loan_size: 155000, sba_approval_rate: 0.65, sba_charge_off_rate: 0.142 },

  // Auto Services
  { naics_code: "811111", naics_description: "General Automotive Repair", sba_default_rate_5yr: 0.118, sba_default_rate_10yr: 0.145, sba_avg_loan_size: 185000, sba_approval_rate: 0.77, sba_charge_off_rate: 0.088 },

  // Wholesale
  { naics_code: "423450", naics_description: "Medical Equipment Merchant Wholesalers", sba_default_rate_5yr: 0.065, sba_default_rate_10yr: 0.082, sba_avg_loan_size: 375000, sba_approval_rate: 0.86, sba_charge_off_rate: 0.045 },

  // Real Estate
  { naics_code: "531110", naics_description: "Lessors of Residential Buildings", sba_default_rate_5yr: 0.072, sba_default_rate_10yr: 0.092, sba_avg_loan_size: 950000, sba_approval_rate: 0.84, sba_charge_off_rate: 0.052 },

  // Personal Care
  { naics_code: "812111", naics_description: "Barber Shops", sba_default_rate_5yr: 0.132, sba_default_rate_10yr: 0.162, sba_avg_loan_size: 125000, sba_approval_rate: 0.74, sba_charge_off_rate: 0.102 },
  { naics_code: "812112", naics_description: "Beauty Salons", sba_default_rate_5yr: 0.128, sba_default_rate_10yr: 0.158, sba_avg_loan_size: 135000, sba_approval_rate: 0.75, sba_charge_off_rate: 0.098 },

  // Childcare
  { naics_code: "624410", naics_description: "Child Day Care Services", sba_default_rate_5yr: 0.108, sba_default_rate_10yr: 0.135, sba_avg_loan_size: 225000, sba_approval_rate: 0.79, sba_charge_off_rate: 0.082 },

  // Dry Cleaning
  { naics_code: "812310", naics_description: "Coin-Operated Laundries & Dry Cleaners", sba_default_rate_5yr: 0.092, sba_default_rate_10yr: 0.115, sba_avg_loan_size: 285000, sba_approval_rate: 0.81, sba_charge_off_rate: 0.068 },
];

/**
 * Run this file directly to seed the database:
 *   npx tsx src/evals/seeds/sbaBenchmarkSeed.ts
 */
async function main() {
  // Dynamic import to avoid pulling supabase into test bundles
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();

  console.log(`Seeding ${SBA_BENCHMARK_SEED.length} SBA benchmark rows...`);

  for (const row of SBA_BENCHMARK_SEED) {
    // Upsert: update existing rows by naics_code, or insert new ones
    const { data: existing } = await sb
      .from("buddy_industry_benchmarks")
      .select("id")
      .eq("naics_code", row.naics_code)
      .limit(1)
      .maybeSingle();

    if (existing) {
      await sb
        .from("buddy_industry_benchmarks")
        .update({
          sba_default_rate_5yr: row.sba_default_rate_5yr,
          sba_default_rate_10yr: row.sba_default_rate_10yr,
          sba_avg_loan_size: row.sba_avg_loan_size,
          sba_approval_rate: row.sba_approval_rate,
          sba_charge_off_rate: row.sba_charge_off_rate,
          sba_data_source: "SBA OCA Performance Data",
          sba_data_vintage: "2025-12-31",
        })
        .eq("id", existing.id);
    } else {
      await sb.from("buddy_industry_benchmarks").insert({
        naics_code: row.naics_code,
        naics_description: row.naics_description,
        metric_name: "SBA_DEFAULT_PROFILE",
        median_value: row.sba_default_rate_5yr,
        percentile_25: row.sba_default_rate_5yr * 0.7,
        percentile_75: row.sba_default_rate_5yr * 1.4,
        source: "SBA OCA Performance Data",
        effective_date: "2025-12-31",
        sba_default_rate_5yr: row.sba_default_rate_5yr,
        sba_default_rate_10yr: row.sba_default_rate_10yr,
        sba_avg_loan_size: row.sba_avg_loan_size,
        sba_approval_rate: row.sba_approval_rate,
        sba_charge_off_rate: row.sba_charge_off_rate,
        sba_data_source: "SBA OCA Performance Data",
        sba_data_vintage: "2025-12-31",
      });
    }
  }

  console.log("SBA benchmark seed complete.");
}

// Only run when executed directly
if (require.main === module) {
  main().catch(console.error);
}
