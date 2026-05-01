/**
 * SOP citation registry — current as of SOP 50 10 8 (effective June 1, 2025)
 * + Procedural Notice 5000-875701 (SBSS sunset, March 1, 2026)
 * + Procedural Notice 5000-876626 (citizenship/residency, March 1, 2026).
 *
 * For per-rule citations see sba_policy_rules.sop_reference column.
 */
export const SOP_VERSION = "SOP_50_10_8" as const;
export const SOP_EFFECTIVE_DATE = "2025-06-01" as const;

export const PROCEDURAL_NOTICES = {
  SBSS_SUNSET: {
    notice_number: "5000-875701",
    effective_date: "2026-03-01",
    title: "SBSS Sunset for Federally Regulated Lenders",
  },
  CITIZENSHIP_RESIDENCY: {
    notice_number: "5000-876626",
    effective_date: "2026-03-01",
    title: "100% U.S. Citizen / LPR / U.S. National Ownership",
  },
  FRANCHISE_CERTIFICATION_DEADLINE: {
    deadline: "2026-06-30",
    note:
      "Brands listed as of May 2023 must complete SBA Franchisor Certification by this date.",
  },
} as const;

export const SOP_RULES = {
  ELIGIBILITY: {
    id: "SOP_50_10_8_A2",
    description: "For-profit small business meeting size standards",
    citation: "SOP 50 10 8 §A Ch.2",
  },
  CASH_FLOW: {
    id: "SOP_50_10_8_B1",
    description:
      "Cash flow supports debt service per program-specific DSCR minimums",
    citation: "SOP 50 10 8 §B Ch.1",
  },
  EQUITY_INJECTION: {
    id: "SOP_50_10_8_B2_EQUITY",
    description:
      "10% equity of total project cost; seller note ≤50% of equity if full standby",
    citation: "SOP 50 10 8 §B Ch.2",
  },
  COLLATERAL: {
    id: "SOP_50_10_8_B4",
    description:
      "Required to extent available; specific haircuts in fully-secured calc",
    citation: "SOP 50 10 8 §B Ch.4",
  },
  CITIZENSHIP: {
    id: "PN_5000_876626",
    description: "100% U.S. citizen / LPR / U.S. National ownership",
    citation: "Procedural Notice 5000-876626 (2026-03-01)",
  },
  SBSS_SUNSET: {
    id: "PN_5000_875701",
    description:
      "SBSS not permitted for federally-regulated lenders on 7(a) Small Loans",
    citation: "Procedural Notice 5000-875701 (2026-03-01)",
  },
} as const;
