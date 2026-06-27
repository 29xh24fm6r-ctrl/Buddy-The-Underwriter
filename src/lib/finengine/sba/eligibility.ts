/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 5: native SBA credit engine.
 *
 * 7(a) / 504 eligibility, use-of-proceeds validation, a SOP exception detector,
 * and a memo-language INPUT generator (narrative inputs only — it never sets a
 * number, NG1). Thresholds resolve from the policy registry (equity injection,
 * occupancy); structural program rules cite SOP 50 10 8 (as amended, eff.
 * 2026-03-01 for citizenship/SBSS). Pure — no DB.
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

export const SOP_VERSION = "SOP 50 10 8";
export const SOP_AS_AMENDED = "2026-03-01"; // citizenship/residency + SBSS sunset PNs

export type SbaProgram = "7A_STANDARD" | "7A_SMALL" | "504";

export type SbaApplication = {
  program: SbaProgram;
  forProfit: boolean;
  meetsSizeStandard: boolean;
  /** Owners with citizenship/LPR status documented (fraction 0..1). */
  ownershipDocumentedPct: number;
  ownersUsCitizenOrLpr: boolean;
  creditElsewhereAvailable: boolean; // if true, ineligible (must NOT be available elsewhere)
  equityInjectionPct: number | null;
  occupancyPct?: number | null; // 504 / owner-occ
  usesOfProceeds: UseOfProceeds[];
  affiliationResolved: boolean;
  fourTwentyFiveSixCOrdered: boolean; // 4506-C IRS verification
  isChangeOfOwnership?: boolean;
};

export type UseOfProceeds = { code: string; amount: number };

export type EligibilityFinding = { rule: string; status: "PASS" | "FAIL" | "EXCEPTION"; detail: string; citation: string };

// Uses that are categorically ineligible for 7(a).
const INELIGIBLE_USE_CODES = new Set([
  "PASSIVE_REAL_ESTATE_INVESTMENT",
  "LENDING_ACTIVITY",
  "SPECULATION",
  "PYRAMID_SALES",
  "GAMBLING",
  "ILLEGAL_ACTIVITY",
  "REPAY_DELINQUENT_TAXES",
  "PAY_CREDITOR_IN_POSITION_TO_SUSTAIN_LOSS",
]);

export function validateUseOfProceeds(uses: UseOfProceeds[]): EligibilityFinding[] {
  const findings: EligibilityFinding[] = [];
  for (const u of uses) {
    if (INELIGIBLE_USE_CODES.has(u.code)) {
      findings.push({
        rule: "use_of_proceeds",
        status: "FAIL",
        detail: `Ineligible use of proceeds: ${u.code} ($${Math.round(u.amount).toLocaleString("en-US")}).`,
        citation: `${SOP_VERSION} §A Ch.3 — Eligible Use of Proceeds`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({ rule: "use_of_proceeds", status: "PASS", detail: "All stated uses are eligible.", citation: `${SOP_VERSION} §A Ch.3` });
  }
  return findings;
}

export function checkEligibility(app: SbaApplication, ctx?: PolicyContext): { eligible: boolean; findings: EligibilityFinding[] } {
  const findings: EligibilityFinding[] = [];
  const cite = (s: string) => `${SOP_VERSION} ${s}`;

  findings.push({ rule: "for_profit", status: app.forProfit ? "PASS" : "FAIL", detail: app.forProfit ? "For-profit operating business." : "Not a for-profit business.", citation: cite("§A Ch.2 — Eligibility") });
  findings.push({ rule: "size_standard", status: app.meetsSizeStandard ? "PASS" : "FAIL", detail: app.meetsSizeStandard ? "Within size standard." : "Exceeds size standard.", citation: cite("§A Ch.2 — Size") });
  findings.push({ rule: "affiliation", status: app.affiliationResolved ? "PASS" : "EXCEPTION", detail: app.affiliationResolved ? "Affiliation analyzed." : "Affiliation not resolved.", citation: cite("13 CFR 121.301") });
  findings.push({ rule: "citizenship", status: app.ownersUsCitizenOrLpr ? "PASS" : "FAIL", detail: app.ownersUsCitizenOrLpr ? "Owners are US citizens / LPR." : "Ownership citizenship/residency not satisfied.", citation: `${SOP_VERSION} (as amended ${SOP_AS_AMENDED}) — Citizenship/Residency` });
  findings.push({ rule: "credit_elsewhere", status: app.creditElsewhereAvailable ? "FAIL" : "PASS", detail: app.creditElsewhereAvailable ? "Credit available elsewhere — ineligible." : "Credit not reasonably available elsewhere.", citation: cite("§A Ch.2 — Credit Elsewhere") });
  findings.push({ rule: "irs_4506c", status: app.fourTwentyFiveSixCOrdered ? "PASS" : "EXCEPTION", detail: app.fourTwentyFiveSixCOrdered ? "4506-C tax transcript verification ordered." : "4506-C not ordered.", citation: cite("§B — Verification") });

  // Equity injection (registry).
  const eqMin = resolvePolicy("equity_injection_min", ctx).effective ?? 0.1;
  if (app.isChangeOfOwnership || app.equityInjectionPct != null) {
    const ok = (app.equityInjectionPct ?? 0) >= eqMin;
    findings.push({ rule: "equity_injection", status: ok ? "PASS" : "FAIL", detail: `Equity injection ${((app.equityInjectionPct ?? 0) * 100).toFixed(0)}% vs ${(eqMin * 100).toFixed(0)}% min.`, citation: cite("§B Ch.2 — Equity Injection") });
  }

  // Occupancy (504 / owner-occ).
  if (app.program === "504" && app.occupancyPct != null) {
    const occMin = resolvePolicy("occupancy_min", { ...ctx, productId: "SBA_504" }).effective ?? 0.51;
    findings.push({ rule: "occupancy", status: app.occupancyPct >= occMin ? "PASS" : "FAIL", detail: `Occupancy ${(app.occupancyPct * 100).toFixed(0)}% vs ${(occMin * 100).toFixed(0)}% min.`, citation: cite("— 504 Owner-Occupancy") });
  }

  findings.push(...validateUseOfProceeds(app.usesOfProceeds));

  const eligible = !findings.some((f) => f.status === "FAIL");
  return { eligible, findings };
}

/** SOP exception detector — surfaces every finding needing a written exception. */
export function detectSopExceptions(app: SbaApplication, ctx?: PolicyContext): EligibilityFinding[] {
  const { findings } = checkEligibility(app, ctx);
  return findings.filter((f) => f.status === "FAIL" || f.status === "EXCEPTION");
}

/**
 * Memo-language INPUTS (narrative only — never numbers; NG1). Returns structured
 * narrative seeds the memo engine (Phase 6) renders; the engine, not this
 * generator, owns any figure.
 */
export function buildSbaMemoLanguageInputs(app: SbaApplication, ctx?: PolicyContext): { section: string; narrative: string }[] {
  const exceptions = detectSopExceptions(app, ctx);
  return [
    { section: "program", narrative: `SBA ${app.program.replace("_", " ")} under ${SOP_VERSION}.` },
    { section: "credit_elsewhere", narrative: app.creditElsewhereAvailable ? "Credit-elsewhere test not met." : "Applicant could not obtain credit elsewhere on reasonable terms without the SBA guaranty." },
    { section: "eligibility_exceptions", narrative: exceptions.length ? `Exceptions requiring write-up: ${exceptions.map((e) => e.rule).join(", ")}.` : "No eligibility exceptions identified." },
  ];
}
