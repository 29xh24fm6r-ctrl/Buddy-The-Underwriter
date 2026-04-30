import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { scanForPII } =
  require("../piiScanner") as typeof import("../piiScanner");

const BASE_CTX = {
  borrowerFirstName: "Jane",
  borrowerLastName: "Doe",
  businessLegalName: "Acme Widgets LLC",
  businessDbaName: "Acme Widgets",
  city: "Madison",
  zip: "53703",
};

test("clean narrative: no hits", () => {
  const text =
    "A Midwestern SBA 7(a) loan for $500K, 120-month term. The borrower operates a restaurant with 5-10yr of operating history and 12 years of relevant industry experience. Buddy SBA Score: 78 (selective_fit). Projected DSCR Year 1: 1.5x.";
  const r = scanForPII(text, BASE_CTX);
  assert.equal(r.hasPII, false);
  assert.deepEqual(r.hits, []);
});

test("email pattern caught", () => {
  const r = scanForPII("Contact jane@example.com for details.", BASE_CTX);
  assert.equal(r.hasPII, true);
  assert.ok(r.hits.includes("email pattern"));
});

test("phone pattern caught (dashed)", () => {
  const r = scanForPII("Call 608-555-1234.", BASE_CTX);
  assert.equal(r.hasPII, true);
  assert.ok(r.hits.includes("phone pattern"));
});

test("phone pattern caught (dotted)", () => {
  const r = scanForPII("Call 608.555.1234.", BASE_CTX);
  assert.ok(r.hits.includes("phone pattern"));
});

test("phone pattern caught (parenthesized)", () => {
  const r = scanForPII("Call (608) 555-1234.", BASE_CTX);
  assert.ok(r.hits.includes("phone pattern"));
});

test("ZIP code caught", () => {
  const r = scanForPII("ZIP 53703 is the target market.", BASE_CTX);
  assert.ok(r.hits.includes("ZIP pattern"));
  // Known-bad matches its own ZIP too.
  assert.ok(r.hits.includes("ZIP"));
});

test("street address caught", () => {
  const r = scanForPII("Business at 1234 Main Street.", BASE_CTX);
  assert.ok(r.hits.includes("street address pattern"));
});

test("borrower first name caught", () => {
  const r = scanForPII("Jane has 12 years of experience.", BASE_CTX);
  assert.ok(r.hits.includes("borrower first name"));
});

test("business legal name caught", () => {
  const r = scanForPII(
    "Acme Widgets LLC is seeking a loan.",
    BASE_CTX,
  );
  assert.ok(r.hits.includes("business legal name"));
});

test("city name caught", () => {
  const r = scanForPII("The borrower is based in Madison.", BASE_CTX);
  assert.ok(r.hits.includes("city name"));
});

test("null tokens are skipped (no crash on missing fields)", () => {
  const r = scanForPII("A clean narrative.", {
    borrowerFirstName: null,
    borrowerLastName: null,
    businessLegalName: null,
    businessDbaName: null,
    city: null,
    zip: null,
  });
  assert.equal(r.hasPII, false);
});

test("case-insensitive matching on borrower name", () => {
  const r = scanForPII("JANE and jane both match.", BASE_CTX);
  assert.ok(r.hits.includes("borrower first name"));
});

test("word-boundary required: 'Janeville' does NOT match 'Jane'", () => {
  // \b prevents substring matches.
  const r = scanForPII("The town of Janeville is nearby.", {
    ...BASE_CTX,
    borrowerFirstName: "Jane",
  });
  assert.equal(r.hits.includes("borrower first name"), false);
});

test("multiple hits accumulated", () => {
  const r = scanForPII(
    "Jane Doe at jane@example.com in Madison 53703.",
    BASE_CTX,
  );
  assert.ok(r.hits.length >= 3);
  assert.ok(r.hits.includes("email pattern"));
  assert.ok(r.hits.includes("borrower first name"));
  assert.ok(r.hits.includes("city name"));
});
