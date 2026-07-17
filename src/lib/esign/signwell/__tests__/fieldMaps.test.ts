import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTemplateFields } from "@/lib/esign/signwell/fieldMaps";

test("buildTemplateFields: unknown form code -> []", () => {
  assert.deepEqual(buildTemplateFields("FORM_DOES_NOT_EXIST", { a: "1" }), []);
});

test("buildTemplateFields: form with an empty map -> [] (today's state for every form until Templates are built)", () => {
  assert.deepEqual(buildTemplateFields("FORM_1919", { "section_i.borrower_legal_name": "Acme Co" }), []);
});

test("buildTemplateFields: skips values missing from the values map and empty-string values", () => {
  const fields = buildTemplateFields("FORM_1919", {});
  assert.deepEqual(fields, []);
});
