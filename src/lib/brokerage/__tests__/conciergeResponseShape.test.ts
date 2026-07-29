import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { computeNextRequiredFields } =
  require("../borrowerConversation") as typeof import("../borrowerConversation");
const { BORROWER_FIELD_REGISTRY } =
  require("../../sba/forms/borrowerFieldRegistry") as typeof import("../../sba/forms/borrowerFieldRegistry");

/**
 * Phase 4 contract, extended by SPEC-M5 CONVERSATIONAL-INTAKE-1: the
 * concierge response's `nextRequiredFields` carries the documented shape.
 *
 * computeNextRequiredFields now lives in borrowerConversation.ts (shared
 * text/voice module, no DB/cookie state) instead of being duplicated inline
 * here — this file imports the real function so a future refactor that
 * breaks the contract surfaces here directly, no separate frozen copy to
 * keep in sync.
 */

function readinessHintFromProgress(progressPct: number): string {
  if (progressPct >= 100) return "Ready to upload supporting documents.";
  if (progressPct >= 60) return "Almost there — a few facts to go.";
  if (progressPct >= 30) return "Good start — keep going.";
  return "Tell Buddy a bit more about your business and loan need.";
}

const BOOTSTRAP_KEYS = [
  "borrower.first_name",
  "borrower.email",
  "business.legal_name_or_industry",
  "loan.amount_requested",
  "loan.use_of_proceeds",
  "business.is_franchise",
];

// Same fixture proven exhaustive by borrowerConversation.test.ts's
// "computeNextCriticalField ... returns null once every applicable-form
// required field is already known" case: with no owners known, only Form
// 1919 is applicable, and this is every business/loan field it requires.
const FULLY_ANSWERED_1919_FACTS = {
  borrower: { first_name: "Ana", email: "a@b.co" },
  business: {
    legal_name: "Acme LLC",
    ein: "12-3456789",
    address_street: "1 Main St",
    address_city: "Springfield",
    address_state: "IL",
    address_zip: "62701",
    phone: "555-0100",
    entity_type: "llc",
    naics: "541511",
    employee_count: 5,
    year_founded: 2015,
    has_pending_sba_application: false,
    has_bankruptcy_history: false,
    has_pending_lawsuits: false,
    is_engaged_in_lobbying: false,
    is_franchise: false,
  },
  loan: { amount_requested: 250000, use_of_proceeds: "working capital" },
};

test("computeNextRequiredFields returns the bootstrap keys when facts are empty", () => {
  assert.deepEqual(computeNextRequiredFields({}), BOOTSTRAP_KEYS);
});

test("computeNextRequiredFields treats is_franchise=false as satisfied (boolean check, not truthy)", () => {
  const facts = {
    borrower: { first_name: "A", email: "a@b.co" },
    business: { legal_name: "Acme", is_franchise: false },
    loan: { amount_requested: 1, use_of_proceeds: "x" },
  };
  assert.equal(computeNextRequiredFields(facts).includes("business.is_franchise"), false);
});

test("computeNextRequiredFields stays on the bootstrap phase until every bootstrap key is satisfied", () => {
  const facts = {
    borrower: { first_name: "Ana" },
    business: { legal_name: "Acme LLC", is_franchise: false },
    loan: { amount_requested: 250000, use_of_proceeds: "equipment" },
  };
  // borrower.email is still missing — bootstrap phase, no registry fields yet.
  assert.deepEqual(computeNextRequiredFields(facts), ["borrower.email"]);
});

test("computeNextRequiredFields expands into the full registry once bootstrap is satisfied (SPEC-M5)", () => {
  const facts = {
    borrower: { first_name: "Ana", email: "a@b.co" },
    business: { legal_name: "Acme LLC", is_franchise: false },
    loan: { amount_requested: 250000, use_of_proceeds: "equipment" },
  };
  const missing = computeNextRequiredFields(facts);
  for (const k of BOOTSTRAP_KEYS) assert.equal(missing.includes(k), false);
  const einEntry = BORROWER_FIELD_REGISTRY.find((f) => f.key === "ein");
  assert.ok(einEntry, "fixture assumption: registry still has an ein entry");
  assert.ok(missing.includes(einEntry!.factPath), "expected an unset 1919-required field to appear");
});

test("computeNextRequiredFields returns [] once every applicable-form-required field is known", () => {
  assert.deepEqual(computeNextRequiredFields(FULLY_ANSWERED_1919_FACTS), []);
});

test("computeNextRequiredFields treats a field present in canonicallyAnswered as satisfied", () => {
  const facts = {
    borrower: { first_name: "Ana", email: "a@b.co" },
    business: { legal_name: "Acme LLC", is_franchise: false },
    loan: { amount_requested: 250000, use_of_proceeds: "equipment" },
  };
  const einEntry = BORROWER_FIELD_REGISTRY.find((f) => f.key === "ein")!;
  const withoutCanonical = computeNextRequiredFields(facts);
  assert.ok(withoutCanonical.includes(einEntry.factPath));

  const withCanonical = computeNextRequiredFields(facts, new Set([einEntry.factPath]));
  assert.equal(withCanonical.includes(einEntry.factPath), false);
});

test("readinessHintFromProgress thresholds", () => {
  assert.match(readinessHintFromProgress(0), /Tell Buddy/);
  assert.match(readinessHintFromProgress(30), /Good start/);
  assert.match(readinessHintFromProgress(60), /Almost there/);
  assert.match(readinessHintFromProgress(100), /Ready to upload/);
});
