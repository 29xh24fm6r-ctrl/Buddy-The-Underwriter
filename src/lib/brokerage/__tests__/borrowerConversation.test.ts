import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { mergeExtractedFacts, computeNextCriticalField } =
  require("../borrowerConversation") as typeof import("../borrowerConversation");

test("mergeExtractedFacts: a later turn mentioning one owner updates that owner in place without dropping others", () => {
  const existing = {
    owners: [
      { full_name: "Jane Doe", ownership_pct: 60 },
      { full_name: "John Smith", ownership_pct: 40 },
    ],
  };
  const incoming = {
    owners: [{ full_name: "Jane Doe", date_of_birth: "1980-01-01" }],
  };

  const merged = mergeExtractedFacts(existing, incoming);

  assert.equal((merged.owners as any[]).length, 2, "John Smith must not be dropped");
  const jane = (merged.owners as any[]).find((o) => o.full_name === "Jane Doe");
  assert.equal(jane.ownership_pct, 60, "prior field must be retained");
  assert.equal(jane.date_of_birth, "1980-01-01", "new field must be merged in");
});

test("mergeExtractedFacts: a brand-new owner name is appended, not merged into an unrelated entry", () => {
  const existing = { owners: [{ full_name: "Jane Doe", ownership_pct: 60 }] };
  const incoming = { owners: [{ full_name: "New Person", ownership_pct: 25 }] };

  const merged = mergeExtractedFacts(existing, incoming);
  assert.equal((merged.owners as any[]).length, 2);
});

test("computeNextCriticalField: with no facts known, surfaces a base Form 1919 business field", () => {
  const result = computeNextCriticalField({});
  assert.ok(result);
  assert.ok(result!.formsUnlocked >= 1);
});

test("computeNextCriticalField: returns null once every applicable-form required field is already known", () => {
  // No owners known -> only Form 1919 (business + loan scope) is applicable.
  const facts = {
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
    },
    loan: { amount_requested: 250000, use_of_proceeds: "working capital" },
  };
  const result = computeNextCriticalField(facts);
  assert.equal(result, null);
});
