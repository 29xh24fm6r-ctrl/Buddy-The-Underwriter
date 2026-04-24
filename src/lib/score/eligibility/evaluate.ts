/**
 * Buddy SBA Score eligibility engine.
 *
 * ─── Important naming note ───────────────────────────────────────────
 * The Sprint 0 spec calls this function `evaluateSbaEligibility`, but
 * a different function by that name already exists at
 * src/lib/sba/eligibilityEngine.ts with a different signature and 11
 * consumers. Renaming that breaks callers. We name the new one
 * `evaluateBuddySbaEligibility` here to avoid the collision.
 * ────────────────────────────────────────────────────────────────────
 *
 * 9 SOP 50 10 7.1 categories:
 *   1. for_profit             — real logic (reads borrower_applications.business_entity_type)
 *   2. size_standard          — real logic (NAICS top-50 table, default-deny on unknown)
 *   3. use_of_proceeds_prohibited — real logic (regex over buddy_sba_packages.use_of_proceeds)
 *   4. franchise_sba_eligible — real logic (franchise_brands.sba_eligible + sba_certification_status)
 *   5. hard_blockers          — real logic (buddy_sba_risk_profiles.hard_blockers)
 *   6. passive_business       — scaffolded (returns pass unless marked, TODO richer detection)
 *   7. real_estate_speculation — scaffolded
 *   8. pyramid_mlm            — scaffolded
 *   9. lending_investment     — scaffolded (simple NAICS prefix check)
 *
 * Pure function. No DB, no I/O. The caller loads inputs and passes them.
 */

import type {
  EligibilityCheck,
  EligibilityFailure,
  EligibilityResult,
} from "../types";
import { evaluateSizeStandard } from "./sbaSizeStandards";

const SOP = {
  size_standard: "SOP 50 10 7.1, Chapter 2 — Size Standards (13 CFR §121.201)",
  for_profit: "SOP 50 10 7.1, Chapter 2 — Eligibility (for-profit requirement)",
  use_of_proceeds: "SOP 50 10 7.1, Chapter 3, Section A — Eligible Use of Proceeds",
  passive: "SOP 50 10 7.1, Chapter 2 — Ineligible Businesses (passive businesses)",
  franchise: "SOP 50 10 7.1, Chapter 2 — Franchises and SBA Franchise Directory",
  hard_blocker: "SOP 50 10 7.1 (risk profile hard blockers)",
  real_estate: "SOP 50 10 7.1, Chapter 2 — Real Estate Investment (speculation exclusion)",
  pyramid: "SOP 50 10 7.1, Chapter 2 — Ineligible Businesses (pyramid/MLM)",
  lending: "SOP 50 10 7.1, Chapter 2 — Ineligible Businesses (lending/investment)",
} as const;

/** Ineligible entity types — business must be for-profit. */
const INELIGIBLE_ENTITY_TYPES = new Set(
  ["NONPROFIT", "GOVERNMENT", "PUBLIC_ENTITY", "501C3", "NON_PROFIT"],
);

/**
 * Prohibited use-of-proceeds patterns. Matched case-insensitively against
 * each use_of_proceeds entry's category or description text.
 */
const PROHIBITED_UOP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\brefinance\b.*\bpersonal\b/i, label: "refinance of personal debt" },
  { pattern: /\bpay(ing)?\s+off\s+(past-?due|delinquent)\b/i, label: "paying off delinquent federal debt" },
  { pattern: /\bgambling\b/i, label: "gambling" },
  { pattern: /\bspecul(ation|ative)\b/i, label: "speculation" },
  { pattern: /\bpassive\s+investment\b/i, label: "passive investment" },
  { pattern: /\billegal\b/i, label: "illegal activity" },
  { pattern: /\bequity\s+distribution\b/i, label: "equity distribution to owners" },
  { pattern: /\bbuy(ing)?\s+out\s+.*\b(partner|shareholder)\b.*\bnon-operating\b/i, label: "buyout of non-operating owner" },
];

const LENDING_NAICS_PREFIXES = new Set([
  "522", // credit intermediation
  "523", // securities/investment
  "525", // funds, trusts
]);

export type BuddyEligibilityInputs = {
  naics: string | null;
  industry: string | null;
  businessEntityType: string | null;
  annualRevenueUsd: number | null;
  employeeCount: number | null;
  /** Array of use-of-proceeds entries (any shape — we look for string content). */
  useOfProceeds: unknown[] | null;
  /** Parallel to use-of-proceeds but the jsonb object from buddy_sba_packages. */
  sourcesAndUses: unknown | null;
  isFranchise: boolean;
  franchiseSbaEligible: boolean | null;
  franchiseSbaCertificationStatus: string | null;
  hardBlockers: string[];
};

function mkCheck(
  check: string,
  category: EligibilityCheck["category"],
  passed: boolean,
  sopReference: string,
  detail?: string,
): EligibilityCheck {
  return { check, category, passed, sopReference, detail };
}

function mkFail(
  check: string,
  category: EligibilityFailure["category"],
  reason: string,
  sopReference: string,
): EligibilityFailure {
  return { check, category, reason, sopReference };
}

function collectUopText(
  useOfProceeds: unknown[] | null,
  sourcesAndUses: unknown,
): string {
  const parts: string[] = [];
  if (Array.isArray(useOfProceeds)) {
    for (const entry of useOfProceeds) {
      if (typeof entry === "string") parts.push(entry);
      else if (entry && typeof entry === "object") parts.push(JSON.stringify(entry));
    }
  }
  if (sourcesAndUses && typeof sourcesAndUses === "object") {
    parts.push(JSON.stringify(sourcesAndUses));
  }
  return parts.join("\n");
}

export function evaluateBuddySbaEligibility(
  inputs: BuddyEligibilityInputs,
): EligibilityResult {
  const checks: EligibilityCheck[] = [];
  const failures: EligibilityFailure[] = [];

  // ─── 1. For-profit ────────────────────────────────────────────────────
  const entityTypeUpper = (inputs.businessEntityType ?? "").toUpperCase().trim();
  if (!entityTypeUpper) {
    checks.push(mkCheck("for_profit_unknown", "for_profit", false, SOP.for_profit,
      "business_entity_type missing — cannot verify for-profit status"));
    failures.push(mkFail("for_profit_unknown", "for_profit",
      "Business entity type not provided; SBA requires for-profit status verification",
      SOP.for_profit));
  } else if (INELIGIBLE_ENTITY_TYPES.has(entityTypeUpper)) {
    checks.push(mkCheck("for_profit", "for_profit", false, SOP.for_profit,
      `entity type ${entityTypeUpper} is not SBA-eligible`));
    failures.push(mkFail("for_profit", "for_profit",
      `Business entity type ${entityTypeUpper} is not SBA-eligible — SBA loans require for-profit entities`,
      SOP.for_profit));
  } else {
    checks.push(mkCheck("for_profit", "for_profit", true, SOP.for_profit,
      `entity type ${entityTypeUpper} is a for-profit structure`));
  }

  // ─── 2. Size standard ─────────────────────────────────────────────────
  const sizeOutcome = evaluateSizeStandard({
    naics: inputs.naics,
    annualRevenueUsd: inputs.annualRevenueUsd,
    employeeCount: inputs.employeeCount,
  });
  checks.push(mkCheck(
    "size_standard",
    "size_standard",
    sizeOutcome.passed,
    SOP.size_standard,
    sizeOutcome.reason,
  ));
  if (!sizeOutcome.passed) {
    failures.push(mkFail(
      "size_standard",
      "size_standard",
      sizeOutcome.reason,
      SOP.size_standard,
    ));
  }

  // ─── 3. Use of proceeds ───────────────────────────────────────────────
  const uopText = collectUopText(inputs.useOfProceeds, inputs.sourcesAndUses);
  if (!uopText) {
    checks.push(mkCheck("use_of_proceeds_unknown", "use_of_proceeds", false, SOP.use_of_proceeds,
      "use_of_proceeds and sources_and_uses both empty"));
    failures.push(mkFail("use_of_proceeds_unknown", "use_of_proceeds",
      "Use of proceeds not provided; required for SBA eligibility check",
      SOP.use_of_proceeds));
  } else {
    const matched = PROHIBITED_UOP_PATTERNS.filter((p) => p.pattern.test(uopText));
    if (matched.length > 0) {
      const labels = matched.map((m) => m.label).join(", ");
      checks.push(mkCheck("use_of_proceeds", "use_of_proceeds", false, SOP.use_of_proceeds,
        `prohibited: ${labels}`));
      failures.push(mkFail("use_of_proceeds", "use_of_proceeds",
        `Use of proceeds includes SBA-prohibited category/categories: ${labels}`,
        SOP.use_of_proceeds));
    } else {
      checks.push(mkCheck("use_of_proceeds", "use_of_proceeds", true, SOP.use_of_proceeds,
        "no prohibited use-of-proceeds patterns detected"));
    }
  }

  // ─── 4. Franchise SBA-eligibility (when franchise) ────────────────────
  if (inputs.isFranchise) {
    const sbaEligible = inputs.franchiseSbaEligible === true;
    const status = (inputs.franchiseSbaCertificationStatus ?? "").toLowerCase();
    const statusOk = ["certified", "approved", "eligible", "listed"].includes(status);
    const passed = sbaEligible && statusOk;
    checks.push(mkCheck(
      "franchise_sba_eligible",
      "franchise",
      passed,
      SOP.franchise,
      `sba_eligible=${inputs.franchiseSbaEligible}, status=${inputs.franchiseSbaCertificationStatus ?? "null"}`,
    ));
    if (!passed) {
      failures.push(mkFail(
        "franchise_sba_eligible",
        "franchise",
        `Franchise not confirmed SBA-eligible (sba_eligible=${inputs.franchiseSbaEligible}, certification status=${inputs.franchiseSbaCertificationStatus ?? "null"})`,
        SOP.franchise,
      ));
    }
  } else {
    checks.push(mkCheck(
      "franchise_sba_eligible",
      "franchise",
      true,
      SOP.franchise,
      "not a franchise deal — check not applicable",
    ));
  }

  // ─── 5. Hard blockers from risk profile ───────────────────────────────
  if (inputs.hardBlockers.length === 0) {
    checks.push(mkCheck("hard_blockers", "hard_blocker", true, SOP.hard_blocker,
      "no hard blockers recorded on risk profile"));
  } else {
    checks.push(mkCheck("hard_blockers", "hard_blocker", false, SOP.hard_blocker,
      `${inputs.hardBlockers.length} hard blocker(s) present`));
    for (const [i, blocker] of inputs.hardBlockers.entries()) {
      failures.push(mkFail(
        `hard_blocker_${i + 1}`,
        "hard_blocker",
        blocker,
        SOP.hard_blocker,
      ));
    }
  }

  // ─── 6. Passive business (scaffolded) ─────────────────────────────────
  // Real detection requires NAICS classification + business-model evidence.
  // Today: flag only if use-of-proceeds mentions "passive" (already caught
  // in rule 3). Keep this check as an explicit pass so the framework is
  // complete and future logic has a hook.
  checks.push(mkCheck(
    "passive_business",
    "passive",
    true,
    SOP.passive,
    "scaffolded — richer passive-business detection deferred",
  ));

  // ─── 7. Real-estate speculation (scaffolded) ──────────────────────────
  // Detect 531* NAICS (real estate) combined with speculative use-of-proceeds
  // language. Today: naive check.
  const naics = (inputs.naics ?? "").trim();
  const isRealEstate531 = naics.startsWith("531");
  const speculativeText = /\bspecul/i.test(uopText);
  if (isRealEstate531 && speculativeText) {
    checks.push(mkCheck("real_estate_speculation", "other", false, SOP.real_estate,
      "NAICS 531* combined with speculative language in use-of-proceeds"));
    failures.push(mkFail("real_estate_speculation", "other",
      "Real-estate NAICS (531*) with speculative use-of-proceeds language; SBA excludes speculation",
      SOP.real_estate));
  } else {
    checks.push(mkCheck("real_estate_speculation", "other", true, SOP.real_estate,
      "scaffolded — deep real-estate speculation detection deferred"));
  }

  // ─── 8. Pyramid / MLM (scaffolded) ────────────────────────────────────
  // Real detection: compensation structure review. Today: none.
  checks.push(mkCheck(
    "pyramid_mlm",
    "other",
    true,
    SOP.pyramid,
    "scaffolded — pyramid/MLM detection deferred",
  ));

  // ─── 9. Lending / investment business ─────────────────────────────────
  const naicsPrefix = naics.slice(0, 3);
  if (LENDING_NAICS_PREFIXES.has(naicsPrefix)) {
    checks.push(mkCheck("lending_investment", "other", false, SOP.lending,
      `NAICS ${naics} is in lending/investment sector (${naicsPrefix})`));
    failures.push(mkFail("lending_investment", "other",
      `NAICS ${naics} identifies a lending or investment business; SBA excludes this category`,
      SOP.lending));
  } else {
    checks.push(mkCheck("lending_investment", "other", true, SOP.lending,
      "not a lending/investment NAICS"));
  }

  return {
    passed: failures.length === 0,
    failures,
    checks,
  };
}
