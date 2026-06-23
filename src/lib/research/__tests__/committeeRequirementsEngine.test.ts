import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

/**
 * SPEC-BIE-COMMITTEE-EVIDENCE-REQUIREMENTS-ENGINE-1
 * Proactive committee-evidence requirements engine. Pure module.
 */

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { buildCommitteeRequirementsPlan } =
  require_("@/lib/research/committeeRequirementsEngine") as typeof import("@/lib/research/committeeRequirementsEngine");

type Input = import("@/lib/research/committeeRequirementsEngine").CommitteeRequirementsInput;

// OmniCare dc52c626: LOC_SECURED working-capital deal, rich loan file, weak public web.
function omnicare(over: Partial<Input> = {}): Input {
  return {
    loanType: "LOC_SECURED",
    loanAmount: 1_500_000,
    collateralType: null,
    useOfProceeds: "Working Capital while bringing on large Fortune 500 sized clients",
    hasStructuredLoanRequest: false,
    naicsCode: "561422",
    naicsDescription: "Telemarketing and contact center",
    isPrivate: true,
    hqCity: "Durant",
    hqState: "OK",
    legalName: "OmniCare 365",
    dba: null,
    subject: { website: "www.omnicare365.com" },
    sourceSnapshots: [{ source_type: "borrower_official_website", status: "collected" }],
    committeeTasks: [],
    evidenceRows: [
      { id: "c1", thread_origin: "competitive", claim: "TeleDirect — regional competitor", source_uris: [] },
      { id: "c2", thread_origin: "competitive", claim: "ASK Telemarketing", source_uris: [] },
      { id: "m1", thread_origin: "management", claim: "Matt Hunt, President" },
      { id: "i1", thread_origin: "industry", claim: "NAICS 561422 ~$30.9B", source_types: [] },
      { id: "mk1", thread_origin: "market", claim: "Durant economy", source_types: ["unknown_public_web"] },
    ],
    documents: [
      { id: "d1", canonical_type: "INCOME_STATEMENT", original_filename: "is.pdf" },
      { id: "d2", canonical_type: "BALANCE_SHEET" },
      { id: "d3", canonical_type: "BUSINESS_TAX_RETURN" },
      { id: "d4", canonical_type: "AR_AGING" },
    ],
    financialFacts: [
      { fact_key: "DSCR" }, { fact_key: "GCF_DSCR" }, { fact_key: "TOTAL_REVENUE" }, { fact_key: "ELIGIBLE_AR" },
    ],
    borrowerStory: {
      products_services: "Call center / BPO services",
      customer_concentration: "High concentration in Home Depot; new Aetna contract",
      competitive_position: "Mid-tier high-touch",
      website: "www.omnicare365.com",
    },
    managementProfiles: [{ id: "p1", person_name: "Matt Hunt", title: "President" }],
    ...over,
  };
}

const byKey = (plan: ReturnType<typeof buildCommitteeRequirementsPlan>, k: string) =>
  plan.required_evidence_items.find((i) => i.key === k)!;

// ── all 8 outputs present ─────────────────────────────────────────────────────

test("[plan] produces all required output sections", () => {
  const p = buildCommitteeRequirementsPlan(omnicare());
  assert.ok(Array.isArray(p.required_evidence_items) && p.required_evidence_items.length > 0);
  assert.ok(Array.isArray(p.optional_evidence_items));
  assert.ok(Array.isArray(p.blocker_prevention_tasks));
  assert.ok(Array.isArray(p.committee_readiness_gaps));
  assert.ok(p.source_collection_plan && Array.isArray(p.source_collection_plan.items));
  assert.ok(p.attestation_plan && Array.isArray(p.attestation_plan.items));
  assert.equal(p.adverse_screen_plan.required, true);
  assert.ok(p.scale_plausibility_plan);
});

// ── OmniCare acceptance 10 — status mapping ───────────────────────────────────

test("[omnicare] website requirement = satisfied", () => {
  const p = buildCommitteeRequirementsPlan(omnicare());
  assert.equal(byKey(p, "entity_website_snapshot").status, "satisfied");
});

test("[omnicare] management = preliminary_satisfied, committee verification still open (blocks committee)", () => {
  const i = byKey(buildCommitteeRequirementsPlan(omnicare()), "management_profile_and_role");
  assert.equal(i.status, "preliminary_satisfied");
  assert.equal(i.blocks_committee, true);
  assert.equal(i.blocks_preliminary, false);
});

test("[omnicare] DSCR / financials / collateral = satisfied where linked", () => {
  const p = buildCommitteeRequirementsPlan(omnicare());
  assert.equal(byKey(p, "dscr_spread_output").status, "satisfied");
  assert.equal(byKey(p, "financial_statements_or_tax").status, "satisfied");
  assert.equal(byKey(p, "collateral_records").status, "satisfied");
  assert.equal(byKey(p, "customer_concentration_ar_support").status, "satisfied");
});

test("[omnicare] loan request / use of proceeds = open", () => {
  assert.equal(byKey(buildCommitteeRequirementsPlan(omnicare()), "loan_request_use_of_proceeds").status, "open");
});

test("[omnicare] SOS / business registry = open", () => {
  assert.equal(byKey(buildCommitteeRequirementsPlan(omnicare()), "entity_sos_or_attestation").status, "open");
});

test("[omnicare] adverse screen = open", () => {
  assert.equal(byKey(buildCommitteeRequirementsPlan(omnicare()), "adverse_screen").status, "open");
});

test("[omnicare] industry + market source = open", () => {
  const p = buildCommitteeRequirementsPlan(omnicare());
  assert.equal(byKey(p, "industry_source").status, "open");
  assert.equal(byKey(p, "market_geography_source").status, "open");
});

test("[omnicare] competitor support = needs_review", () => {
  assert.equal(byKey(buildCommitteeRequirementsPlan(omnicare()), "competitive_support").status, "needs_review");
});

test("[omnicare] scale plausibility = needs analyst conclusion (needs_review, never auto-clears)", () => {
  const p = buildCommitteeRequirementsPlan(omnicare());
  const i = byKey(p, "scale_plausibility_conclusion");
  assert.equal(i.status, "needs_review");
  assert.equal(p.scale_plausibility_plan.applicable, true);
  assert.equal(p.scale_plausibility_plan.auto_clear_forbidden, true);
  assert.equal(p.scale_plausibility_plan.analyst_conclusion_required, true);
  assert.ok(p.scale_plausibility_plan.missing_supports.includes("analyst_conclusion"));
});

test("[omnicare] committee readiness gaps explain all 8 blocker areas", () => {
  const p = buildCommitteeRequirementsPlan(omnicare());
  const blockers = new Set(p.committee_readiness_gaps.flatMap((g) => g.prevents_blockers));
  // 8 distinct committee blocker areas from the OmniCare gate.
  for (const b of [
    "Stronger public/institutional sources required",
    "Evidence coverage below committee threshold",
    "Section needs committee-grade sources: Management Intelligence",
    "Section needs committee-grade sources: Litigation and Risk",
    "Section needs committee-grade sources: Industry Overview",
    "Section needs committee-grade sources: Market Intelligence",
    "Section needs committee-grade sources: Competitive Landscape",
    "Contradiction unresolved: scale plausibility",
  ]) {
    assert.ok(blockers.has(b), `missing readiness-gap coverage for: ${b}`);
  }
});

test("[omnicare] preliminary is not blocked by any requirement", () => {
  const p = buildCommitteeRequirementsPlan(omnicare());
  assert.equal(p.required_evidence_items.some((i) => i.blocks_preliminary), false);
});

// ── prevention behavior (rule 8) ──────────────────────────────────────────────

test("[prevention] open/needs_review committee items become prevention tasks", () => {
  const p = buildCommitteeRequirementsPlan(omnicare());
  const keys = new Set(p.blocker_prevention_tasks.map((t) => t.key));
  for (const k of ["entity_sos_or_attestation", "industry_source", "adverse_screen", "scale_plausibility_conclusion", "loan_request_use_of_proceeds"]) {
    assert.ok(keys.has(k), `expected prevention task for ${k}`);
  }
  // satisfied items are not prevention tasks
  assert.equal(keys.has("dscr_spread_output"), false);
});

// ── review integration (rule 9) ───────────────────────────────────────────────

test("[review] committee_grade_accepted website → satisfied", () => {
  const p = buildCommitteeRequirementsPlan(
    omnicare({
      sourceSnapshots: [],
      evidenceRows: [],
      committeeTasks: [{ task_type: "borrower_website_snapshot", review_status: "committee_grade", committee_grade_accepted: true }],
    }),
  );
  assert.equal(byKey(p, "entity_website_snapshot").status, "satisfied");
});

test("[review] accepted management stays preliminary_satisfied (committee verification still open)", () => {
  const p = buildCommitteeRequirementsPlan(
    omnicare({ committeeTasks: [{ task_type: "management_attestation", review_status: "accepted", committee_grade_accepted: false }] }),
  );
  assert.equal(byKey(p, "management_profile_and_role").status, "preliminary_satisfied");
});

test("[review] accepted competitive (analyst acceptance) → satisfied", () => {
  const p = buildCommitteeRequirementsPlan(
    omnicare({ committeeTasks: [{ task_type: "competitive_source", review_status: "accepted", committee_grade_accepted: false }] }),
  );
  assert.equal(byKey(p, "competitive_support").status, "satisfied");
});

test("[review] accepted scale_plausibility does NOT satisfy (needs explicit conclusion)", () => {
  const p = buildCommitteeRequirementsPlan(
    omnicare({ committeeTasks: [{ task_type: "financial_file", blocker_type: "contradiction_gap", review_status: "accepted", auto_clear_forbidden: true }] }),
  );
  assert.equal(byKey(p, "scale_plausibility_conclusion").status, "needs_review");
});

test("[review] rejected/weak/wrong-entity keeps requirement open", () => {
  for (const rs of ["rejected", "weak_source", "wrong_entity"]) {
    const p = buildCommitteeRequirementsPlan(
      omnicare({
        sourceSnapshots: [{ source_type: "borrower_official_website", status: "collected" }],
        committeeTasks: [{ task_type: "borrower_website_snapshot", review_status: rs }],
      }),
    );
    assert.equal(byKey(p, "entity_website_snapshot").status, "open", `review ${rs} should keep open`);
  }
});

// ── loan-type behavior ────────────────────────────────────────────────────────

test("[loan] non-LOC term loan with no growth purpose → scale plan not applicable", () => {
  const p = buildCommitteeRequirementsPlan(
    omnicare({ loanType: "TERM", useOfProceeds: "Refinance existing equipment note", collateralType: "Equipment" }),
  );
  assert.equal(p.scale_plausibility_plan.applicable, false);
  assert.equal(p.required_evidence_items.some((i) => i.key === "scale_plausibility_conclusion"), false);
});

test("[loan] competitive item omitted when no competitors named", () => {
  const p = buildCommitteeRequirementsPlan(omnicare({ evidenceRows: [{ id: "m1", thread_origin: "management", claim: "Matt Hunt" }] }));
  assert.equal(p.required_evidence_items.some((i) => i.key === "competitive_support"), false);
});
