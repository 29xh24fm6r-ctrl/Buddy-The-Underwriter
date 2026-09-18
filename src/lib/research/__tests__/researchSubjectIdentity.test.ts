import test from "node:test";
import assert from "node:assert/strict";
import { generateRunKey, type RunKeyInput } from "../orchestration";
import { assembleResearchEntityProfile, borrowerResearchInterview } from "../buildResearchSubject";

test("research identity changes with borrower details and keeps equivalent inputs idempotent", () => {
  const base: RunKeyInput = { deal_id: "deal", mission_type: "industry_landscape", depth: "committee", subject: { company_name: "Example", geography: "TX", naics_code: "123456" } };
  const key = generateRunKey(base);
  assert.equal(key, generateRunKey({ ...base, subject: { naics_code: "123456", geography: "tx", company_name: " example " } }));
  for (const subject of [
    { ...base.subject, company_name: "Different company" },
    { ...base.subject, geography: "NY" },
    { ...base.subject, naics_code: "654321" },
    { ...base.subject, business_description: "Updated business and project" },
  ]) assert.notEqual(key, generateRunKey({ ...base, subject }));
});

test("confirmed borrower business answers reach research without being labeled banker-certified", () => {
  const borrowerInterview = borrowerResearchInterview({ package_answers: {
    B05: { value: "Drive-through coffee and beverages" },
    B06: { value: "Coffee shops" },
    A01: { value: "Open a franchise location" },
    C09: { value: "Protected personal information must never be included" },
  } });
  assert.deepEqual(Object.keys(borrowerInterview!), ["productsServices", "industry", "project"]);
  const profile = assembleResearchEntityProfile({
    borrowerId: "borrower", borrower: { legal_name: "Example Coffee LLC", city: "Austin", state: "TX" },
    ownershipEntities: [{ display_name: "Example Owner" }], borrowerInterview,
  });
  assert.equal(profile.subject.business_description, "Drive-through coffee and beverages");
  assert.equal(profile.subject.naics_description, "Coffee shops");
  assert.equal(profile.has_banker_certified_anchor, false);
  assert.equal(profile.private_company_mode_eligible, false);
  assert.equal(JSON.stringify(profile).includes("Protected personal information"), false);
  const emptyStaffStory = assembleResearchEntityProfile({
    borrowerId: "borrower", borrower: { legal_name: "Example Coffee LLC" },
    ownershipEntities: [{ display_name: "Example Owner" }], borrowerInterview, story: {},
  });
  assert.equal(emptyStaffStory.has_banker_certified_anchor, false);
  assert.equal(emptyStaffStory.private_company_mode_eligible, false);
});
