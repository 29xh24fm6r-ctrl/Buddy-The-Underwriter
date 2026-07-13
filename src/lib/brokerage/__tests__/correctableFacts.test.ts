import test from "node:test";
import assert from "node:assert/strict";

import {
  CORRECTABLE_FACT_FIELDS,
  correctableFieldFor,
  readFactValue,
} from "../correctableFacts";

test("CORRECTABLE_FACT_FIELDS includes the loan amount special-case and every business-scope registry field", () => {
  assert.ok(CORRECTABLE_FACT_FIELDS.some((f) => f.factPath === "loan.amount_requested"));
  assert.ok(CORRECTABLE_FACT_FIELDS.some((f) => f.factPath === "business.legal_name"));
  assert.ok(CORRECTABLE_FACT_FIELDS.some((f) => f.factPath === "business.ein"));
  // No owner/entity/pfs fields — out of scope for v1 (array-indexed, no UI yet).
  assert.ok(!CORRECTABLE_FACT_FIELDS.some((f) => f.factPath.startsWith("owner.")));
  assert.ok(!CORRECTABLE_FACT_FIELDS.some((f) => f.factPath.startsWith("pfs.")));
});

test("correctableFieldFor finds a known field and rejects an unknown one", () => {
  assert.equal(correctableFieldFor("business.legal_name")?.label, "Business legal name");
  assert.equal(correctableFieldFor("owner.ssn_last4"), undefined);
  assert.equal(correctableFieldFor("not.a.real.path"), undefined);
});

test("readFactValue reads a nested scope.field value", () => {
  const facts = { business: { legal_name: "Acme LLC" }, loan: { amount_requested: 250000 } };
  assert.equal(readFactValue(facts, "business.legal_name"), "Acme LLC");
  assert.equal(readFactValue(facts, "loan.amount_requested"), 250000);
});

test("readFactValue returns null for missing scope, missing field, or malformed path", () => {
  const facts = { business: { legal_name: "Acme LLC" } };
  assert.equal(readFactValue(facts, "loan.amount_requested"), null);
  assert.equal(readFactValue(facts, "business.dba"), null);
  assert.equal(readFactValue(facts, "noscope"), null);
  assert.equal(readFactValue(null, "business.legal_name"), null);
  assert.equal(readFactValue(undefined, "business.legal_name"), null);
});
