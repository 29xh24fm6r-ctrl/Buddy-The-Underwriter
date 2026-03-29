/**
 * Phase 56 — Industry Benchmark Seed Data
 *
 * 20 most common NAICS codes for commercial lending.
 * Sources: SBA 2024, Federal Reserve SBCS 2023, Census Bureau.
 * Synthetic approximations for initial seeding.
 */

export type BenchmarkSeed = {
  naics_code: string;
  naics_description: string;
  metrics: Record<string, { median: number; p25: number; p75: number }>;
};

export const BENCHMARK_SEEDS: BenchmarkSeed[] = [
  { naics_code: "722511", naics_description: "Full-Service Restaurants", metrics: {
    gross_margin: { median: 0.62, p25: 0.55, p75: 0.68 },
    net_margin: { median: 0.04, p25: 0.01, p75: 0.08 },
    current_ratio: { median: 0.85, p25: 0.55, p75: 1.20 },
    dso: { median: 8, p25: 3, p75: 15 },
    debt_to_equity: { median: 3.5, p25: 1.8, p75: 6.0 },
  }},
  { naics_code: "236220", naics_description: "Commercial Building Construction", metrics: {
    gross_margin: { median: 0.18, p25: 0.12, p75: 0.25 },
    net_margin: { median: 0.04, p25: 0.01, p75: 0.07 },
    current_ratio: { median: 1.35, p25: 1.05, p75: 1.80 },
    dso: { median: 55, p25: 35, p75: 75 },
    debt_to_equity: { median: 2.0, p25: 0.8, p75: 3.5 },
  }},
  { naics_code: "541110", naics_description: "Offices of Lawyers", metrics: {
    gross_margin: { median: 0.85, p25: 0.78, p75: 0.92 },
    net_margin: { median: 0.22, p25: 0.12, p75: 0.35 },
    current_ratio: { median: 1.50, p25: 1.00, p75: 2.20 },
    dso: { median: 65, p25: 40, p75: 90 },
    debt_to_equity: { median: 1.2, p25: 0.4, p75: 2.5 },
  }},
  { naics_code: "621111", naics_description: "Offices of Physicians", metrics: {
    gross_margin: { median: 0.65, p25: 0.55, p75: 0.75 },
    net_margin: { median: 0.12, p25: 0.05, p75: 0.20 },
    current_ratio: { median: 1.80, p25: 1.20, p75: 2.80 },
    dso: { median: 42, p25: 28, p75: 60 },
    debt_to_equity: { median: 1.5, p25: 0.5, p75: 3.0 },
  }},
  { naics_code: "531120", naics_description: "Lessors of Nonresidential Buildings", metrics: {
    gross_margin: { median: 0.55, p25: 0.40, p75: 0.70 },
    net_margin: { median: 0.15, p25: 0.05, p75: 0.28 },
    current_ratio: { median: 1.10, p25: 0.70, p75: 1.60 },
    dso: { median: 30, p25: 15, p75: 50 },
    debt_to_equity: { median: 2.8, p25: 1.2, p75: 5.0 },
  }},
  { naics_code: "238220", naics_description: "Plumbing & HVAC Contractors", metrics: {
    gross_margin: { median: 0.35, p25: 0.25, p75: 0.45 },
    net_margin: { median: 0.06, p25: 0.02, p75: 0.10 },
    current_ratio: { median: 1.40, p25: 1.00, p75: 1.90 },
    dso: { median: 45, p25: 28, p75: 65 },
    debt_to_equity: { median: 1.8, p25: 0.6, p75: 3.2 },
  }},
  { naics_code: "311812", naics_description: "Commercial Bakeries", metrics: {
    gross_margin: { median: 0.42, p25: 0.32, p75: 0.52 },
    net_margin: { median: 0.05, p25: 0.01, p75: 0.09 },
    current_ratio: { median: 1.20, p25: 0.85, p75: 1.65 },
    dso: { median: 25, p25: 12, p75: 40 },
    debt_to_equity: { median: 2.2, p25: 1.0, p75: 4.0 },
  }},
  { naics_code: "423510", naics_description: "Metal Service Centers", metrics: {
    gross_margin: { median: 0.22, p25: 0.16, p75: 0.28 },
    net_margin: { median: 0.03, p25: 0.01, p75: 0.06 },
    current_ratio: { median: 1.60, p25: 1.20, p75: 2.10 },
    dso: { median: 48, p25: 32, p75: 65 },
    debt_to_equity: { median: 1.5, p25: 0.6, p75: 2.8 },
  }},
  { naics_code: "443142", naics_description: "Electronics Stores", metrics: {
    gross_margin: { median: 0.30, p25: 0.22, p75: 0.38 },
    net_margin: { median: 0.03, p25: 0.00, p75: 0.06 },
    current_ratio: { median: 1.45, p25: 1.00, p75: 2.00 },
    dso: { median: 12, p25: 5, p75: 22 },
    debt_to_equity: { median: 2.0, p25: 0.8, p75: 3.8 },
  }},
  { naics_code: "721110", naics_description: "Hotels and Motels", metrics: {
    gross_margin: { median: 0.68, p25: 0.58, p75: 0.78 },
    net_margin: { median: 0.08, p25: 0.02, p75: 0.15 },
    current_ratio: { median: 0.90, p25: 0.55, p75: 1.35 },
    dso: { median: 15, p25: 5, p75: 30 },
    debt_to_equity: { median: 3.2, p25: 1.5, p75: 5.5 },
  }},
];
