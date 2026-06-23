import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateSectionSourceStatuses,
  summarizeSectionStatuses,
  type SectionSourceContext,
} from "@/lib/research/sectionSourceStatus";
import type { SourceType } from "@/lib/research/sourcePolicy";

/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 3
 * Section source status split (preliminary vs committee).
 */

function ctx(over: Partial<SectionSourceContext> = {}): SectionSourceContext {
  return {
    sourceTypes: new Set<SourceType>(),
    entityConflict: false,
    entityConfirmedPublicly: false,
    hasBorrowerOfficialSource: false,
    hasBorrowerWebsiteOnFile: false,
    hasBankerStory: false,
    hasBusinessDescription: false,
    hasIndustry: false,
    managementProfileOnFile: false,
    managementBasis: null,
    managementPubliclyConfirmed: false,
    adverseSearchAttempted: false,
    adverseFindingPublic: false,
    namedCompetitors: 0,
    ...over,
  };
}

const find = (rs: ReturnType<typeof evaluateSectionSourceStatuses>, s: string) =>
  rs.find((r) => r.section === s)!;

test("[section] private borrower with entity lock + file evidence → Borrower Profile preliminary pass", () => {
  const rs = evaluateSectionSourceStatuses(ctx({
    hasBorrowerWebsiteOnFile: true,
    hasBankerStory: true,
    hasBusinessDescription: true,
    hasIndustry: true,
  }));
  const bp = find(rs, "Borrower Profile");
  assert.equal(bp.preliminary_source_status, "pass");
  // committee not satisfied without a public/official source
  assert.notEqual(bp.committee_source_status, "pass");
  assert.equal(bp.evidence_basis, "banker_certified");
});

test("[section] management fallback → preliminary warn, committee not pass", () => {
  const rs = evaluateSectionSourceStatuses(ctx({
    managementProfileOnFile: true,
    managementBasis: "fallback",
  }));
  const m = find(rs, "Management Intelligence");
  assert.equal(m.preliminary_source_status, "warn");
  assert.notEqual(m.committee_source_status, "pass");
  assert.equal(m.evidence_basis, "fallback");
  assert.match(m.detail, /banker-certified\/file-based/i);
});

test("[section] industry/market require external sources for committee", () => {
  // industry known but no external sources → committee warn
  const noExternal = evaluateSectionSourceStatuses(ctx({ hasIndustry: true }));
  assert.equal(find(noExternal, "Industry Overview").committee_source_status, "warn");
  assert.equal(find(noExternal, "Market Intelligence").committee_source_status, "warn");

  // with government/market sources → committee pass
  const withExternal = evaluateSectionSourceStatuses(ctx({
    hasIndustry: true,
    sourceTypes: new Set<SourceType>(["government_data", "market_research"]),
  }));
  assert.equal(find(withExternal, "Industry Overview").committee_source_status, "pass");
  assert.equal(find(withExternal, "Market Intelligence").committee_source_status, "pass");
});

test("[section] competitive: named competitors → preliminary pass, committee needs sources", () => {
  const rs = evaluateSectionSourceStatuses(ctx({ namedCompetitors: 3 }));
  const c = find(rs, "Competitive Landscape");
  assert.equal(c.preliminary_source_status, "pass");
  assert.equal(c.committee_source_status, "warn");
});

test("[section] wrong-entity conflict fails ALL section statuses", () => {
  const rs = evaluateSectionSourceStatuses(ctx({
    entityConflict: true,
    hasBorrowerWebsiteOnFile: true,
    hasBankerStory: true,
    hasIndustry: true,
    namedCompetitors: 5,
    sourceTypes: new Set<SourceType>(["government_data", "court_record", "company_primary"]),
  }));
  for (const r of rs) {
    assert.equal(r.committee_source_status, "fail");
    assert.equal(r.preliminary_source_status, "fail");
    assert.equal(r.evidence_basis, "insufficient");
  }
});

test("[section] output distinguishes preliminary vs committee (summary)", () => {
  const rs = evaluateSectionSourceStatuses(ctx({
    hasBorrowerWebsiteOnFile: true,
    hasBankerStory: true,
    hasBusinessDescription: true,
    hasIndustry: true,
    managementProfileOnFile: true,
    managementBasis: "fallback",
    namedCompetitors: 2,
    adverseSearchAttempted: true,
  }));
  const sum = summarizeSectionStatuses(rs);
  assert.equal(sum.total, 6);
  assert.ok(sum.preliminaryReady >= sum.committeeReady);
  // committee blockers exist for a file-based private borrower
  assert.ok(sum.committeeBlockers.length > 0);
});
