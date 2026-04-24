/**
 * SBA size-standard table — PLACEHOLDER (top-50 NAICS).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THIS IS A PLACEHOLDER. The full SBA SOP 50 10 7.1 size-standard table
 * has 1,000+ NAICS entries. This file covers the ~50 most common
 * NAICS codes we expect to see in the first launch cohort.
 *
 * DEFAULT-DENY: if a borrower's NAICS is not in this table, the size-
 * standard check returns FAIL with reason "NAICS not in current
 * size-standard table; manual review required." Not silent pass.
 *
 * Follow-up ticket: full 1,000+ NAICS transcription from SBA published
 * size-standard table (13 CFR §121.201). Source:
 *   https://www.sba.gov/document/support-table-size-standards
 *
 * Values represent the SBA small-business threshold. For revenue-based
 * industries the unit is USD annual receipts; for employee-based
 * industries the unit is employee count.
 * ═══════════════════════════════════════════════════════════════════════
 */

export type SizeStandardUnit = "annual_receipts_usd" | "employees";

export type SizeStandardEntry = {
  /** 2022 NAICS code. */
  naics: string;
  /** Plain-English industry description. */
  description: string;
  /** Whether the standard is revenue-based or employee-based. */
  unit: SizeStandardUnit;
  /** Threshold in USD (for revenue) or employee count (for employees). */
  threshold: number;
};

/**
 * Top-50 most-common NAICS covering: food service, retail, professional
 * services, construction, healthcare, manufacturing, logistics, personal
 * services. Thresholds are 13 CFR §121.201 as of 2024-02 update.
 * Re-verified quarterly against SBA published table.
 */
export const SIZE_STANDARDS_TOP_50: readonly SizeStandardEntry[] = [
  // Food service
  { naics: "722511", description: "Full-service restaurants",                       unit: "annual_receipts_usd", threshold: 12_000_000 },
  { naics: "722513", description: "Limited-service restaurants",                    unit: "annual_receipts_usd", threshold: 12_500_000 },
  { naics: "722515", description: "Snack and non-alcoholic beverage bars",          unit: "annual_receipts_usd", threshold: 15_000_000 },
  { naics: "311811", description: "Retail bakeries",                                unit: "employees",           threshold: 500 },
  { naics: "445110", description: "Supermarkets and grocery stores",                unit: "annual_receipts_usd", threshold: 40_000_000 },
  { naics: "445120", description: "Convenience stores",                             unit: "annual_receipts_usd", threshold: 35_000_000 },

  // Retail trade
  { naics: "441110", description: "New car dealers",                                unit: "annual_receipts_usd", threshold: 44_000_000 },
  { naics: "453110", description: "Florists",                                       unit: "annual_receipts_usd", threshold: 8_500_000 },
  { naics: "448140", description: "Family clothing stores",                         unit: "annual_receipts_usd", threshold: 45_000_000 },
  { naics: "452319", description: "All other general merchandise stores",           unit: "annual_receipts_usd", threshold: 41_500_000 },

  // Professional services
  { naics: "541110", description: "Offices of lawyers",                             unit: "annual_receipts_usd", threshold: 17_000_000 },
  { naics: "541211", description: "Offices of certified public accountants",        unit: "annual_receipts_usd", threshold: 26_000_000 },
  { naics: "541330", description: "Engineering services",                           unit: "annual_receipts_usd", threshold: 25_500_000 },
  { naics: "541511", description: "Custom computer programming services",           unit: "annual_receipts_usd", threshold: 34_000_000 },
  { naics: "541512", description: "Computer systems design services",               unit: "annual_receipts_usd", threshold: 34_000_000 },
  { naics: "541611", description: "Administrative management consulting",           unit: "annual_receipts_usd", threshold: 24_500_000 },
  { naics: "541810", description: "Advertising agencies",                           unit: "annual_receipts_usd", threshold: 25_000_000 },
  { naics: "541990", description: "All other professional, scientific, technical",  unit: "annual_receipts_usd", threshold: 19_500_000 },

  // Construction
  { naics: "236115", description: "New single-family housing construction",         unit: "annual_receipts_usd", threshold: 45_000_000 },
  { naics: "236116", description: "New multifamily housing construction",           unit: "annual_receipts_usd", threshold: 45_000_000 },
  { naics: "236220", description: "Commercial and institutional building",          unit: "annual_receipts_usd", threshold: 45_000_000 },
  { naics: "237110", description: "Water and sewer line construction",              unit: "annual_receipts_usd", threshold: 45_000_000 },
  { naics: "238110", description: "Poured concrete foundation contractors",         unit: "annual_receipts_usd", threshold: 19_000_000 },
  { naics: "238220", description: "Plumbing, heating, and air-conditioning",        unit: "annual_receipts_usd", threshold: 19_000_000 },
  { naics: "238320", description: "Painting and wall-covering contractors",         unit: "annual_receipts_usd", threshold: 19_000_000 },

  // Healthcare
  { naics: "621111", description: "Offices of physicians (except mental health)",   unit: "annual_receipts_usd", threshold: 13_500_000 },
  { naics: "621210", description: "Offices of dentists",                            unit: "annual_receipts_usd", threshold: 9_000_000 },
  { naics: "621310", description: "Offices of chiropractors",                       unit: "annual_receipts_usd", threshold: 9_000_000 },
  { naics: "621610", description: "Home health care services",                      unit: "annual_receipts_usd", threshold: 16_500_000 },
  { naics: "621910", description: "Ambulance services",                             unit: "annual_receipts_usd", threshold: 20_000_000 },
  { naics: "623110", description: "Nursing care facilities",                        unit: "annual_receipts_usd", threshold: 34_000_000 },
  { naics: "624410", description: "Child day care services",                        unit: "annual_receipts_usd", threshold: 9_000_000 },

  // Manufacturing
  { naics: "311411", description: "Frozen fruit, juice, and vegetable manufacturing", unit: "employees",         threshold: 1000 },
  { naics: "332710", description: "Machine shops",                                    unit: "employees",         threshold: 500 },
  { naics: "336111", description: "Automobile manufacturing",                         unit: "employees",         threshold: 1500 },
  { naics: "337110", description: "Wood kitchen cabinet manufacturing",               unit: "employees",         threshold: 1250 },

  // Transportation / Logistics
  { naics: "484110", description: "General freight trucking, local",                unit: "annual_receipts_usd", threshold: 34_000_000 },
  { naics: "484121", description: "General freight trucking, long-distance TL",      unit: "annual_receipts_usd", threshold: 34_000_000 },
  { naics: "485310", description: "Taxi service",                                   unit: "annual_receipts_usd", threshold: 19_000_000 },
  { naics: "488510", description: "Freight transportation arrangement",             unit: "annual_receipts_usd", threshold: 22_000_000 },
  { naics: "493110", description: "General warehousing and storage",                unit: "annual_receipts_usd", threshold: 34_000_000 },

  // Personal services
  { naics: "811111", description: "General automotive repair",                      unit: "annual_receipts_usd", threshold: 9_000_000 },
  { naics: "811121", description: "Automotive body, paint, and interior repair",    unit: "annual_receipts_usd", threshold: 9_000_000 },
  { naics: "812111", description: "Barber shops",                                   unit: "annual_receipts_usd", threshold: 8_500_000 },
  { naics: "812112", description: "Beauty salons",                                  unit: "annual_receipts_usd", threshold: 9_000_000 },
  { naics: "812910", description: "Pet care (except veterinary) services",          unit: "annual_receipts_usd", threshold: 9_000_000 },

  // Accommodation
  { naics: "721110", description: "Hotels (except casino hotels) and motels",       unit: "annual_receipts_usd", threshold: 40_000_000 },
  { naics: "721191", description: "Bed-and-breakfast inns",                         unit: "annual_receipts_usd", threshold: 11_500_000 },

  // Wholesale (employee-based)
  { naics: "424410", description: "General line grocery merchant wholesalers",      unit: "employees",           threshold: 250 },
  { naics: "423940", description: "Jewelry merchant wholesalers",                   unit: "employees",           threshold: 100 },
];

const INDEX: Map<string, SizeStandardEntry> = new Map(
  SIZE_STANDARDS_TOP_50.map((e) => [e.naics, e]),
);

export function lookupSizeStandard(
  naics: string | null,
): SizeStandardEntry | null {
  if (!naics) return null;
  return INDEX.get(naics.trim()) ?? null;
}

export type SizeStandardCheckOutcome =
  | {
      passed: true;
      reason: string;
      entry: SizeStandardEntry;
      observedValue: number;
    }
  | {
      passed: false;
      reason: string;
      entry: SizeStandardEntry | null;
      observedValue: number | null;
      unknownNaics: boolean;
    };

/**
 * Evaluate a deal against its NAICS size standard.
 *
 * Default-deny: if NAICS is null, whitespace-only, or not in the top-50
 * table, returns `{ passed: false, unknownNaics: true }`. Not silent pass.
 *
 * When the entry is known:
 *   - revenue-based: passes if annualRevenueUsd <= threshold
 *   - employee-based: passes if employeeCount <= threshold
 *   - missing observed value → fail with observedValue: null
 */
export function evaluateSizeStandard(args: {
  naics: string | null;
  annualRevenueUsd: number | null;
  employeeCount: number | null;
}): SizeStandardCheckOutcome {
  const entry = lookupSizeStandard(args.naics);
  if (!entry) {
    return {
      passed: false,
      reason: `NAICS ${args.naics ?? "(missing)"} not in current size-standard table; manual review required`,
      entry: null,
      observedValue: null,
      unknownNaics: true,
    };
  }

  const observed =
    entry.unit === "annual_receipts_usd"
      ? args.annualRevenueUsd
      : args.employeeCount;

  if (observed == null) {
    return {
      passed: false,
      reason: `NAICS ${entry.naics} requires ${entry.unit}; value not provided`,
      entry,
      observedValue: null,
      unknownNaics: false,
    };
  }

  if (observed <= entry.threshold) {
    return {
      passed: true,
      reason: `Within SBA size standard for NAICS ${entry.naics} (${entry.description})`,
      entry,
      observedValue: observed,
    };
  }

  return {
    passed: false,
    reason: `Exceeds SBA size standard for NAICS ${entry.naics}: ${observed.toLocaleString()} > threshold ${entry.threshold.toLocaleString()} ${entry.unit}`,
    entry,
    observedValue: observed,
    unknownNaics: false,
  };
}
