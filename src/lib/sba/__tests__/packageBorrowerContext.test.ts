import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const { resolvePackageBorrowerContext, loadPackageBorrowerContext } = createRequire(import.meta.url)("../packageBorrowerContext");

test("7 Brew saved borrower identity and franchise intent survive missing legacy application and directory link", () => {
  const result = resolvePackageBorrowerContext({ name: "QA display", city: null }, { legal_name: "QA 7 Brew Franchise Test LLC", city: "Flowery Branch", state: "GA", naics_code: "722515" }, null, { package_answers: { K01: { value: "7 Brew, Flowery Branch" }, K02: { value: "New franchise location" }, B04: { value: "Site search in Flowery Branch" } } });
  assert.equal(result.name, "QA 7 Brew Franchise Test LLC");
  assert.equal(result.city, "Flowery Branch");
  assert.equal(result.franchiseDeclared, true);
  assert.equal(result.franchiseDescription, "7 Brew, Flowery Branch");
  assert.equal(result.proposedLocation, "Site search in Flowery Branch");
});
test("missing evidence and unstructured mention do not become verified franchise status", () => {
  const result = resolvePackageBorrowerContext({}, null, null, { package_answers: { K01: { value: "Not sure yet" } } });
  assert.equal(result.franchiseDeclared, false);
  assert.equal(result.city, null);
  assert.equal(result.naics, null);
});
test("proposed operating city precedes headquarters, legacy application remains supported", () => {
  assert.equal(resolvePackageBorrowerContext({}, { city: "Atlanta", project_address_city: "Flowery Branch" }, null, null).city, "Flowery Branch");
  assert.equal(resolvePackageBorrowerContext({}, null, { business_legal_name: "Legacy LLC" }, null).name, "Legacy LLC");
});
test("context loader rejects missing or cross-bank deals", async () => {
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { bank_id: "other" } }) };
  await assert.rejects(loadPackageBorrowerContext({ from: () => q }, "deal", "bank"), /deal_mismatch/);
});
test("receipts requires an explicit nonnegative amount and calculation basis, never inferred startup zero", () => {
  const context = (amount: unknown, basis: unknown) => resolvePackageBorrowerContext({}, null, null, {
    package_answers: { B07: { value: "The business is preparing to open" }, B13: { value: amount }, B14: { value: basis } },
  });
  for (const amount of [undefined, null, "", "0", false, -1, NaN, Infinity]) {
    assert.equal(context(amount, "Supporting schedule").averageAnnualReceiptsUsd, null);
  }
  assert.equal(context(0, "").averageAnnualReceiptsUsd, null);
  assert.equal(context(0, "Pre-opening; no affiliate receipts").averageAnnualReceiptsUsd, 0);
  assert.equal(context(2400000, "Applicant and affiliates; supporting calculation provided").averageAnnualReceiptsUsd, 2400000);
});
