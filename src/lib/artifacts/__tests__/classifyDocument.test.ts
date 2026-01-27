import test from "node:test";
import assert from "node:assert/strict";
import { mapDocTypeToChecklistKeys } from "../classifyDocument";

test("mapDocTypeToChecklistKeys returns correct keys for IRS_BUSINESS", () => {
  const keys = mapDocTypeToChecklistKeys("IRS_BUSINESS", 2023);
  assert.ok(keys.includes("IRS_BUSINESS_3Y"));
  assert.ok(keys.includes("IRS_BUSINESS_2Y"));
  assert.ok(keys.includes("BTR"));
  assert.ok(keys.includes("TAX_RETURNS"));
});

test("mapDocTypeToChecklistKeys returns correct keys for IRS_PERSONAL", () => {
  const keys = mapDocTypeToChecklistKeys("IRS_PERSONAL", 2023);
  assert.ok(keys.includes("IRS_PERSONAL_3Y"));
  assert.ok(keys.includes("IRS_PERSONAL_2Y"));
  assert.ok(keys.includes("PTR"));
  assert.ok(keys.includes("TAX_RETURNS"));
});

test("mapDocTypeToChecklistKeys returns correct keys for PFS", () => {
  const keys = mapDocTypeToChecklistKeys("PFS", null);
  assert.ok(keys.includes("PFS_CURRENT"));
  assert.ok(keys.includes("PFS"));
  assert.ok(keys.includes("PERSONAL_FINANCIAL_STATEMENT"));
});

test("mapDocTypeToChecklistKeys returns correct keys for RENT_ROLL", () => {
  const keys = mapDocTypeToChecklistKeys("RENT_ROLL", null);
  assert.ok(keys.includes("RENT_ROLL"));
  assert.ok(keys.includes("CURRENT_RENT_ROLL"));
});

test("mapDocTypeToChecklistKeys returns correct keys for T12", () => {
  const keys = mapDocTypeToChecklistKeys("T12", null);
  assert.ok(keys.includes("T12"));
  assert.ok(keys.includes("OPERATING_STATEMENT"));
});

test("mapDocTypeToChecklistKeys returns correct keys for BANK_STATEMENT", () => {
  const keys = mapDocTypeToChecklistKeys("BANK_STATEMENT", null);
  assert.ok(keys.includes("BANK_STATEMENTS"));
});

test("mapDocTypeToChecklistKeys returns empty for OTHER", () => {
  const keys = mapDocTypeToChecklistKeys("OTHER", null);
  assert.equal(keys.length, 0);
});

test("mapDocTypeToChecklistKeys handles entity docs", () => {
  const articles = mapDocTypeToChecklistKeys("ARTICLES", null);
  assert.ok(articles.includes("ARTICLES"));
  assert.ok(articles.includes("ENTITY_DOCS"));

  const opAgreement = mapDocTypeToChecklistKeys("OPERATING_AGREEMENT", null);
  assert.ok(opAgreement.includes("OPERATING_AGREEMENT"));
  assert.ok(opAgreement.includes("ENTITY_DOCS"));
});
