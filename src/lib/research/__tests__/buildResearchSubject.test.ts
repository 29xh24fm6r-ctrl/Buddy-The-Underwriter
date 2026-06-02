import test from "node:test";
import assert from "node:assert/strict";

import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { assembleResearchSubject } from "@/lib/research/buildResearchSubject";

// subjectLock.ts declares `import "server-only"`; redirect it to the repo stub
// before requiring so this pure validator can run under node --test.
mockServerOnly();
const { validateSubjectLock } = createRequire(import.meta.url)(
  "@/lib/research/subjectLock",
) as typeof import("@/lib/research/subjectLock");

/**
 * SPEC-RESEARCH-SUBJECT-LOCK-MEMO-INPUT-PARITY-1
 *
 * The research subject builder must resolve borrower context from the same
 * memo-input sources the borrower-representation contract trusts, so a deal with
 * a banker-certified story / management profile but no legacy borrower_id is no
 * longer treated as having an empty subject. dc52c626 (OmniCare Deal Review) is
 * the live regression target: borrower_id null, borrower_name + borrower story +
 * Matt Hunt management profile populated, ownership_entities empty.
 */

function lockFor(raw: Parameters<typeof assembleResearchSubject>[0]) {
  const { subject } = assembleResearchSubject(raw);
  return validateSubjectLock({
    company_name: subject.company_name,
    naics_code: subject.naics_code,
    naics_description: subject.naics_description,
    business_description: subject.business_description,
    city: subject.city,
    state: subject.state,
    geography: subject.geography,
    website: subject.website,
    dba: subject.dba,
    banker_summary: subject.banker_summary,
    banker_override: subject.banker_override,
  });
}

const OMNICARE_STORY = {
  business_description:
    "A Business Process Outsourcing (BPO) (Call Center) firm founded by Matt Hunt that operates call centers across the US and internationally.",
  products_services:
    "Call center and customer support services, including specialized training programs for enterprise clients.",
  revenue_model: "BPO service contracts with a steady 12% net margin.",
  banker_notes: "A $1.5M tiered revolving line of credit is proposed to manage working-capital gaps.",
  competitive_position: "Strong, high client retention.",
  customers: "Aetna, Home Depot.",
};

test("[V-1] borrower_id null + story present → company name + business description populate, subject lock passes", () => {
  const { subject, represented } = assembleResearchSubject({
    borrowerId: null,
    dealBorrowerName: "OmniCare Deal Review",
    dealName: "OmniCare Deal Review",
    story: OMNICARE_STORY,
    managementProfiles: [],
  });
  assert.equal(represented, true);
  assert.equal(subject.company_name, "OmniCare Deal Review");
  assert.ok((subject.business_description ?? "").includes("Business Process Outsourcing"));
  assert.deepEqual(lockFor({
    borrowerId: null,
    dealBorrowerName: "OmniCare Deal Review",
    dealName: "OmniCare Deal Review",
    story: OMNICARE_STORY,
    managementProfiles: [{ person_name: "Matt Hunt", title: "President", ownership_pct: 100 }],
  }), { ok: true });
});

test("[V-2] borrower_id null + management profile (no ownership_entities) → principals populate", () => {
  const { subject } = assembleResearchSubject({
    borrowerId: null,
    dealBorrowerName: "OmniCare Deal Review",
    story: OMNICARE_STORY,
    ownershipEntities: [],
    managementProfiles: [{ person_name: "Matt Hunt", title: "President", ownership_pct: 100 }],
  });
  assert.equal(subject.principals?.length, 1);
  assert.equal(subject.principals?.[0]?.name, "Matt Hunt");
  assert.equal(subject.principals?.[0]?.title, "President");
});

test("[V-2b] ownership_entities present → preferred over management profiles", () => {
  const { subject } = assembleResearchSubject({
    borrowerId: null,
    story: OMNICARE_STORY,
    ownershipEntities: [{ display_name: "OmniCare Holdings LLC", title: "Parent" }],
    managementProfiles: [{ person_name: "Matt Hunt", title: "President", ownership_pct: 100 }],
  });
  assert.equal(subject.principals?.[0]?.name, "OmniCare Holdings LLC");
});

test("[V-3] no borrower_id / no story / no profile → not represented, subject lock fails", () => {
  const { represented } = assembleResearchSubject({
    borrowerId: null,
    story: null,
    managementProfiles: [],
    ownershipEntities: [],
  });
  assert.equal(represented, false);
  const lock = lockFor({ borrowerId: null, story: null, managementProfiles: [], ownershipEntities: [] });
  assert.equal(lock.ok, false);
  if (!lock.ok) {
    assert.ok(lock.reasons.some((r) => r.includes("legal name")));
    assert.ok(lock.reasons.some((r) => r.includes("Industry not identified")));
  }
});

test("[V-4] missing NAICS does not suppress story context → provisional industry derived", () => {
  const { subject, naics_provisional } = assembleResearchSubject({
    borrowerId: null,
    dealBorrowerName: "OmniCare Deal Review",
    story: OMNICARE_STORY,
    managementProfiles: [{ person_name: "Matt Hunt", title: "President", ownership_pct: 100 }],
  });
  assert.equal(subject.naics_code, "999999"); // never invented
  assert.equal(naics_provisional, true);
  assert.ok((subject.naics_description ?? "").length > 5);
  // Industry hard-gate clears via the provisional description.
  const lock = lockFor({
    borrowerId: null,
    dealBorrowerName: "OmniCare Deal Review",
    story: OMNICARE_STORY,
    managementProfiles: [{ person_name: "Matt Hunt", title: "President", ownership_pct: 100 }],
  });
  assert.equal(lock.ok, true);
});

test("[V-5] borrower_id present with real borrowers row → prefers borrowers, not provisional", () => {
  const { subject, naics_provisional } = assembleResearchSubject({
    borrowerId: "b-1",
    dealBorrowerName: "Fallback Name",
    borrower: {
      legal_name: "OmniCare BPO, Inc.",
      naics_code: "561422",
      naics_description: "Telemarketing Bureaus and Other Contact Centers",
      city: "Austin",
      state: "TX",
    },
    story: OMNICARE_STORY,
  });
  assert.equal(subject.company_name, "OmniCare BPO, Inc.");
  assert.equal(subject.naics_code, "561422");
  assert.equal(naics_provisional, false);
  assert.equal(subject.state, "TX");
});

test("[V-6] anchor composed when banker_notes absent but story + principal present", () => {
  const { subject } = assembleResearchSubject({
    borrowerId: null,
    dealBorrowerName: "OmniCare Deal Review",
    story: { business_description: "A BPO call center firm operating nationally." },
    managementProfiles: [{ person_name: "Matt Hunt", title: "President", ownership_pct: 100 }],
  });
  assert.ok((subject.banker_summary ?? "").length > 10);
  assert.ok((subject.banker_summary ?? "").includes("Matt Hunt"));
});
