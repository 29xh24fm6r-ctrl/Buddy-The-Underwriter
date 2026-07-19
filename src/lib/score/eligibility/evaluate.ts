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
 * 12 SOP 50 10 7.1 categories:
 *   1. for_profit             — real logic (reads borrower_applications.business_entity_type)
 *   2. size_standard          — real logic (NAICS top-50 table, default-deny on unknown)
 *   3. use_of_proceeds_prohibited — real logic (regex over buddy_sba_packages.use_of_proceeds)
 *   4. franchise_sba_eligible — real logic (franchise_brands.sba_eligible + sba_certification_status)
 *   5. hard_blockers          — real logic (buddy_sba_risk_profiles.hard_blockers)
 *   6. passive_business       — scaffolded (returns pass unless marked, TODO richer detection)
 *   7. real_estate_speculation — scaffolded
 *   8. pyramid_mlm            — scaffolded
 *   9. lending_investment     — scaffolded (simple NAICS prefix check)
 *   10. federal_compliance    — real logic (borrower-disclosed via intake "compliance" step; wizard-only, no marketplace equivalent yet)
 *   11. character             — real logic (intake "compliance" step, OR derived from ownership_entities.convicted_or_pleaded/on_parole_or_probation for marketplace deals — see src/lib/score/inputs.ts)
 *   12. affiliates_disclosed  — informational only (never fails; flags for underwriter review)
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
  federal_compliance: "SOP 50 10 7.1, Chapter 2 — Federal Debt Delinquency (SBA Form 1919)",
  character: "SOP 50 10 7.1, Chapter 2 — Character Eligibility (SBA Form 912)",
  affiliates: "SOP 50 10 7.1, Chapter 2 — Affiliation (13 CFR §121.301)",
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

/** Real-estate speculation: text signals beyond the literal word "speculat*". */
const REAL_ESTATE_SPECULATION_PATTERNS: RegExp[] = [
  /\bspecul/i,
  /\bflip(ping)?\b/i,
  /\bhold\s+for\s+appreciation\b/i,
  /\bland\s+bank(ing)?\b/i,
];

/**
 * Pyramid/MLM: NAICS codes associated with direct-sales structures (a soft
 * signal — legitimate direct sellers can share these codes) combined with
 * text describing a multi-level/recruiting compensation structure. Neither
 * signal alone is sufficient; see rule 8 below for how they combine.
 */
const PYRAMID_MLM_NAICS_PREFIXES = new Set([
  "454390", // other direct selling establishments
  "561499", // all other business support services (common MLM catch-all)
]);
const PYRAMID_MLM_TEXT_PATTERNS: RegExp[] = [
  /\bmulti-?level\s+marketing\b/i,
  /\bpyramid\b/i,
  /\bdownline\b/i,
  /\brecruit(ing)?\s+(distributors|reps|representatives)\b/i,
];

/**
 * Passive business: NAICS codes for pure rental/holding activity combined
 * with an absence of active-operations language. A soft heuristic given
 * the limited signal available to this pure function — see rule 6 below.
 */
const PASSIVE_BUSINESS_NAICS_PREFIXES = new Set([
  "531110", // lessors of residential buildings and dwellings
  "531120", // lessors of nonresidential buildings
]);
const ACTIVE_OPERATIONS_TEXT_PATTERNS: RegExp[] = [
  /\bmanage(s|d|ment)?\b/i,
  /\boperat(e|es|ed|ing|ions)\b/i,
  /\bstaff\b/i,
  /\bemployees?\b/i,
];

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
  /**
   * Borrower-disclosed federal-compliance / character / affiliates
   * answers (mirror SBA Forms 1919/912), collected on the intake
   * "compliance" step. `null` means "not yet disclosed" — treated as a
   * pass-with-pending-detail, NOT a failure, so deals that predate this
   * step (or haven't reached it yet) aren't retroactively flagged
   * ineligible. Only an explicit `true` on a disqualifying question
   * hard-fails.
   */
  federalDebtDelinquent: boolean | null;
  taxDelinquent: boolean | null;
  samDebarred: boolean | null;
  felonyConviction: boolean | null;
  incarceratedOrParole: boolean | null;
  priorGovLoanDefault: boolean | null;
  hasAffiliates: boolean | null;
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

  // ─── 6. Passive business ───────────────────────────────────────────────
  // Heuristic given the limited signal in this pure function's inputs:
  // pure rental/holding NAICS + absence of active-operations language in
  // use-of-proceeds/sources-and-uses text. Flags for underwriter review
  // rather than auto-failing — this heuristic can't reliably distinguish a
  // genuinely passive holding company from an active operator that simply
  // didn't mention operations language in its use-of-proceeds text.
  const naics = (inputs.naics ?? "").trim();
  const isPassiveRentalNaics = PASSIVE_BUSINESS_NAICS_PREFIXES.has(naics);
  const hasActiveOperationsLanguage = ACTIVE_OPERATIONS_TEXT_PATTERNS.some((p) => p.test(uopText));
  if (isPassiveRentalNaics && !hasActiveOperationsLanguage) {
    checks.push(mkCheck("passive_business", "passive", true, SOP.passive,
      `NAICS ${naics} is a pure rental/holding code with no active-operations language detected — flagged for underwriter review`));
  } else {
    checks.push(mkCheck("passive_business", "passive", true, SOP.passive,
      "no passive-business signal detected"));
  }

  // ─── 7. Real-estate speculation ────────────────────────────────────────
  // NAICS 531* (real estate) combined with speculative/flip/hold-for-
  // appreciation/land-banking language in use-of-proceeds text.
  const isRealEstate531 = naics.startsWith("531");
  const speculativeText = REAL_ESTATE_SPECULATION_PATTERNS.some((p) => p.test(uopText));
  if (isRealEstate531 && speculativeText) {
    checks.push(mkCheck("real_estate_speculation", "other", false, SOP.real_estate,
      "NAICS 531* combined with speculative/flip/hold-for-appreciation language in use-of-proceeds"));
    failures.push(mkFail("real_estate_speculation", "other",
      "Real-estate NAICS (531*) with speculative use-of-proceeds language; SBA excludes speculation",
      SOP.real_estate));
  } else {
    checks.push(mkCheck("real_estate_speculation", "other", true, SOP.real_estate,
      "no real-estate speculation signal detected"));
  }

  // ─── 8. Pyramid / MLM ──────────────────────────────────────────────────
  // Fails only when BOTH a direct-sales NAICS code AND MLM/pyramid
  // compensation-structure language are present — a NAICS match alone is
  // too common among legitimate direct sellers, and text alone can be a
  // false positive (e.g. discussing a competitor). Text-only match
  // downgrades to pass-with-flag-for-review rather than a blind pass.
  const naicsPrefix6 = naics; // full code — these prefixes are 6-digit
  const hasMlmNaics = PYRAMID_MLM_NAICS_PREFIXES.has(naicsPrefix6);
  const hasMlmText = PYRAMID_MLM_TEXT_PATTERNS.some((p) => p.test(uopText));
  if (hasMlmNaics && hasMlmText) {
    checks.push(mkCheck("pyramid_mlm", "other", false, SOP.pyramid,
      `NAICS ${naics} combined with pyramid/MLM compensation-structure language in use-of-proceeds`));
    failures.push(mkFail("pyramid_mlm", "other",
      "Direct-sales NAICS code combined with pyramid/MLM compensation-structure language; SBA excludes this category",
      SOP.pyramid));
  } else if (hasMlmText) {
    checks.push(mkCheck("pyramid_mlm", "other", true, SOP.pyramid,
      "pyramid/MLM text pattern present without confirmatory NAICS — flagged for underwriter review"));
  } else {
    checks.push(mkCheck("pyramid_mlm", "other", true, SOP.pyramid,
      "no pyramid/MLM signal detected"));
  }

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

  // ─── 10. Federal compliance (delinquent federal debt, taxes, SAM debarment) ──
  {
    const flags: Array<[boolean | null, string]> = [
      [inputs.federalDebtDelinquent, "delinquent on a federal debt"],
      [inputs.taxDelinquent, "delinquent on federal taxes"],
      [inputs.samDebarred, "suspended or debarred from federal programs (SAM.gov)"],
    ];
    const triggered = flags.filter(([v]) => v === true).map(([, label]) => label);
    if (triggered.length > 0) {
      checks.push(mkCheck("federal_compliance", "federal_compliance", false, SOP.federal_compliance,
        `borrower disclosed: ${triggered.join(", ")}`));
      failures.push(mkFail("federal_compliance", "federal_compliance",
        `Borrower disclosed a federal compliance issue: ${triggered.join(", ")}`,
        SOP.federal_compliance));
    } else {
      checks.push(mkCheck("federal_compliance", "federal_compliance", true, SOP.federal_compliance,
        flags.every(([v]) => v === false)
          ? "borrower disclosed no federal compliance issues"
          : "not yet disclosed by borrower"));
    }
  }

  // ─── 11. Character (SBA Form 912-style disclosures) ───────────────────
  {
    const flags: Array<[boolean | null, string]> = [
      [inputs.felonyConviction, "felony conviction"],
      [inputs.incarceratedOrParole, "currently incarcerated, on parole, or on probation"],
      [inputs.priorGovLoanDefault, "prior default on a government loan"],
    ];
    const triggered = flags.filter(([v]) => v === true).map(([, label]) => label);
    if (triggered.length > 0) {
      checks.push(mkCheck("character", "character", false, SOP.character,
        `borrower disclosed: ${triggered.join(", ")}`));
      failures.push(mkFail("character", "character",
        `Borrower disclosed a character eligibility issue: ${triggered.join(", ")}`,
        SOP.character));
    } else {
      checks.push(mkCheck("character", "character", true, SOP.character,
        flags.every(([v]) => v === false)
          ? "borrower disclosed no character eligibility issues"
          : "not yet disclosed by borrower"));
    }
  }

  // ─── 12. Affiliates disclosure (informational — does not itself fail) ─
  // Having affiliates isn't disqualifying by itself; it means affiliate
  // revenue/employees must be included in the size-standard calculation
  // (check 2 above), which today does not consolidate affiliate
  // financials. Surfaced as a pass-with-detail so underwriters know to
  // check manually rather than silently missing it.
  checks.push(mkCheck(
    "affiliates_disclosed",
    "other",
    true,
    SOP.affiliates,
    inputs.hasAffiliates === true
      ? "borrower disclosed affiliates — confirm size standard includes consolidated affiliate revenue/employees"
      : inputs.hasAffiliates === false
        ? "borrower disclosed no affiliates"
        : "not yet disclosed by borrower",
  ));

  return {
    passed: failures.length === 0,
    failures,
    checks,
  };
}
