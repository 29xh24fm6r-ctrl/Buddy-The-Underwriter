import test from "node:test";
import assert from "node:assert/strict";

import {
  assembleResearchEntityProfile,
  isPlaceholderEntityName,
} from "@/lib/research/buildResearchSubject";

/**
 * SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
 *
 * The entity profile distinguishes a placeholder deal label (not web-searchable)
 * from a real legal/DBA/website search name, and flags banker-certified private
 * borrowers so the gate can credit internal evidence. dc52c626 ("OmniCare Deal
 * Review", borrower_id=null, story + Matt Hunt) is the live target.
 */

const OMNICARE_STORY = {
  business_description: "A Business Process Outsourcing (BPO) call center firm founded by Matt Hunt.",
  products_services: "Call center and customer support services.",
  banker_notes: "A $1.5M revolving line of credit is proposed.",
  customers: "Aetna, Home Depot.",
};

test("isPlaceholderEntityName flags deal-review / placeholder labels", () => {
  assert.equal(isPlaceholderEntityName("OmniCare Deal Review"), true);
  assert.equal(isPlaceholderEntityName("New Deal"), true);
  assert.equal(isPlaceholderEntityName("Untitled"), true);
  assert.equal(isPlaceholderEntityName("X"), true);
  assert.equal(isPlaceholderEntityName("OmniCare BPO, Inc."), false);
  assert.equal(isPlaceholderEntityName("Hunt Contact Centers LLC"), false);
});

test("placeholder name + no legal/DBA/website → company_search_name null, name_is_placeholder", () => {
  const p = assembleResearchEntityProfile({
    borrowerId: null,
    dealBorrowerName: "OmniCare Deal Review",
    dealName: "OmniCare Deal Review",
    story: OMNICARE_STORY,
    managementProfiles: [{ person_name: "Matt Hunt", title: "President", ownership_pct: 100 }],
  });
  assert.equal(p.company_search_name, null);
  assert.equal(p.name_is_placeholder, true);
  // Banker-certified anchor present → private mode eligible, certification banker_certified.
  assert.equal(p.has_banker_certified_anchor, true);
  assert.equal(p.private_company_mode_eligible, true);
  assert.equal(p.certification_level, "banker_certified");
  assert.equal(p.subject.private_company_mode, true);
  assert.equal(p.subject.has_banker_certified_anchor, true);
  // company_name still set (subject lock passes) but search name is withheld.
  assert.equal(p.subject.company_name, "OmniCare Deal Review");
  assert.equal(p.subject.company_search_name, null);
});

test("legal name on story → used as company_search_name; public anchor", () => {
  const p = assembleResearchEntityProfile({
    borrowerId: null,
    dealBorrowerName: "OmniCare Deal Review",
    story: { ...OMNICARE_STORY, legal_name: "OmniCare BPO, Inc.", website: "omnicarebpo.com" },
    managementProfiles: [{ person_name: "Matt Hunt", title: "President", ownership_pct: 100 }],
  });
  assert.equal(p.legal_name, "OmniCare BPO, Inc.");
  assert.equal(p.company_search_name, "OmniCare BPO, Inc.");
  assert.equal(p.name_is_placeholder, false);
  assert.equal(p.has_public_anchor, true);
  assert.equal(p.certification_level, "public");
  assert.equal(p.subject.company_name, "OmniCare BPO, Inc.");
  assert.equal(p.subject.website, "omnicarebpo.com");
});

test("borrowers row legal name wins as search name", () => {
  const p = assembleResearchEntityProfile({
    borrowerId: "b-1",
    dealBorrowerName: "OmniCare Deal Review",
    borrower: { legal_name: "OmniCare Holdings LLC", naics_code: "561422", city: "Austin", state: "TX" },
    story: OMNICARE_STORY,
  });
  assert.equal(p.company_search_name, "OmniCare Holdings LLC");
  assert.equal(p.name_is_placeholder, false);
  assert.equal(p.hq_state, "TX");
});

test("non-placeholder display name (no legal/DBA) is an acceptable search name", () => {
  const p = assembleResearchEntityProfile({
    borrowerId: null,
    dealBorrowerName: "Hunt Contact Centers",
    story: OMNICARE_STORY,
    managementProfiles: [{ person_name: "Matt Hunt", title: "President", ownership_pct: 100 }],
  });
  assert.equal(p.company_search_name, "Hunt Contact Centers");
  assert.equal(p.name_is_placeholder, false);
});

test("empty deal → unidentified, no search name", () => {
  const p = assembleResearchEntityProfile({
    borrowerId: null,
    dealName: "New Deal",
    story: null,
    managementProfiles: [],
  });
  assert.equal(p.represented, false);
  assert.equal(p.company_search_name, null);
  assert.equal(p.certification_level, "unidentified");
  assert.equal(p.has_banker_certified_anchor, false);
});
