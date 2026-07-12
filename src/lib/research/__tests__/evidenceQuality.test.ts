import test from "node:test";
import assert from "node:assert/strict";

import {
  scoreEvidenceQuality,
  type EvidenceQualityInput,
} from "@/lib/research/evidenceQuality";

/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 5
 * Evidence lanes + certified-coverage scorer.
 */

function input(over: Partial<EvidenceQualityInput> = {}): EvidenceQualityInput {
  return {
    entityConflict: false,
    entityLockConfirmedPublicly: false,
    hasLegalName: false,
    hasWebsite: false,
    hasHqLocation: false,
    hasBankerIdentitySummary: false,
    hasNaics: false,
    hasIndustryDescription: false,
    hasBusinessDescription: false,
    hasProductsServices: false,
    hasCustomerAnchors: false,
    hasCompetitivePosition: false,
    managementProfileOnFile: false,
    managementPubliclyConfirmed: false,
    hasRevenue: false,
    hasDscr: false,
    hasFinancialStatements: false,
    hasLoanRequest: false,
    hasCollateral: false,
    publicSourceCount: 0,
    primaryInstitutionalCount: 0,
    publicQualityScore: 0,
    hasAdverseScreen: false,
    privateCompanyMode: false,
    ...over,
  };
}

// The canonical "good private file" from the spec.
function goodPrivateFile(over: Partial<EvidenceQualityInput> = {}): EvidenceQualityInput {
  return input({
    hasLegalName: true,
    hasWebsite: true,
    hasHqLocation: true,
    hasBankerIdentitySummary: true,
    hasNaics: true,
    hasIndustryDescription: true,
    hasBusinessDescription: true,
    hasProductsServices: true,
    hasCustomerAnchors: true,
    hasCompetitivePosition: true,
    managementProfileOnFile: true,
    hasRevenue: true,
    hasDscr: true,
    hasFinancialStatements: true,
    hasLoanRequest: true,
    privateCompanyMode: true,
    ...over,
  });
}

test("[evidence] strong private file → preliminary eligible", () => {
  const r = scoreEvidenceQuality(goodPrivateFile());
  assert.equal(r.preliminary_eligible, true);
  assert.ok(r.certified_evidence_coverage_score >= 0.65);
});

test("[evidence] missing financials prevents preliminary", () => {
  const r = scoreEvidenceQuality(goodPrivateFile({
    hasRevenue: false,
    hasDscr: false,
    hasFinancialStatements: false,
  }));
  assert.equal(r.preliminary_eligible, false);
});

test("[evidence] weak public web does NOT block preliminary when file evidence strong", () => {
  const r = scoreEvidenceQuality(goodPrivateFile({
    publicSourceCount: 0,
    primaryInstitutionalCount: 0,
    publicQualityScore: 0,
  }));
  assert.equal(r.preliminary_eligible, true);
  assert.equal(r.public_web_limited, true);
  assert.equal(r.private_company_evidence_mode, true);
});

test("[evidence] committee remains false without public/attested evidence", () => {
  const r = scoreEvidenceQuality(goodPrivateFile({
    entityLockConfirmedPublicly: false,
    primaryInstitutionalCount: 0,
    publicQualityScore: 0,
  }));
  assert.equal(r.committee_eligible, false);
});

test("[evidence] committee eligible needs public verification + institutional sources + coverage", () => {
  const r = scoreEvidenceQuality(goodPrivateFile({
    entityLockConfirmedPublicly: true,
    managementPubliclyConfirmed: true,
    publicSourceCount: 12,
    primaryInstitutionalCount: 4,
    publicQualityScore: 0.7,
    hasAdverseScreen: true,
  }));
  assert.equal(r.committee_eligible, true);
});

// Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1: adverse
// screening was never a hard requirement for committee_grade — a borrower
// with a publicly-verifiable owner and strong sources could reach
// committee_grade with ZERO adverse/litigation record search ever run.
test("[evidence] committee_eligible is false without an adverse screen, even with everything else strong", () => {
  const r = scoreEvidenceQuality(goodPrivateFile({
    entityLockConfirmedPublicly: true,
    managementPubliclyConfirmed: true,
    publicSourceCount: 12,
    primaryInstitutionalCount: 4,
    publicQualityScore: 0.7,
    hasAdverseScreen: false,
  }));
  assert.equal(r.committee_eligible, false);
});

test("[evidence] wrong entity → both eligibility flags hard false", () => {
  const r = scoreEvidenceQuality(goodPrivateFile({
    entityConflict: true,
    entityLockConfirmedPublicly: true,
    publicSourceCount: 20,
    primaryInstitutionalCount: 10,
    publicQualityScore: 0.9,
  }));
  assert.equal(r.preliminary_eligible, false);
  assert.equal(r.committee_eligible, false);
  assert.ok(r.limitations.some((l) => /conflicting public entity/i.test(l)));
});

test("[evidence] lanes are independent (public weak, certified strong)", () => {
  const r = scoreEvidenceQuality(goodPrivateFile({ publicQualityScore: 0.1 }));
  assert.ok(r.banker_certified_evidence_score >= 0.6);
  assert.ok(r.public_web_quality_score <= 0.2);
  assert.ok(r.present_items.length > r.missing_items.length);
});
