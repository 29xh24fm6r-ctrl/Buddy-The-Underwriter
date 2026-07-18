import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm601 } from "@/lib/sba/forms/form601/build";

const COMPLETE_FIELDS = {
  applicant_name: "Acme LLC",
  applicant_name_address_phone: "Acme LLC — 200 Industrial Blvd, Austin, TX 78702 — 555-1234",
  applicant_official_name_title: "Jane Doe, Managing Member",
};

test("buildForm601: not applicable -> { applicable: false }", () => {
  const result = buildForm601({ applicable: false, fields: {}, borrowerOwnershipEntityId: null });
  assert.deepEqual(result, { form: "601", applicable: false });
});

test("buildForm601: applicable, fully complete + borrower signer resolved -> is_complete=true", () => {
  const result = buildForm601({ applicable: true, fields: COMPLETE_FIELDS, borrowerOwnershipEntityId: "o1" });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, true);
  assert.equal(result.missing.length, 0);
});

test("buildForm601: applicable but missing applicant's authorized official -> flagged, is_complete=false", () => {
  const result = buildForm601({
    applicable: true,
    fields: { ...COMPLETE_FIELDS, applicant_official_name_title: null },
    borrowerOwnershipEntityId: "o1",
  });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.includes("applicant_official_name_title"));
});

test("buildForm601: general contractor fields are optional (owner-builder, no separate GC)", () => {
  const result = buildForm601({ applicable: true, fields: COMPLETE_FIELDS, borrowerOwnershipEntityId: "o1" });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, true);
});
