import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { collapseBlankDuplicates } =
  require("../listBorrowerApplications") as typeof import("../listBorrowerApplications");
type BorrowerApplication = import("../listBorrowerApplications").BorrowerApplication;

function app(overrides: Partial<BorrowerApplication>): BorrowerApplication {
  return {
    id: "id",
    businessName: "New borrower inquiry",
    loanPurpose: null,
    status: null,
    statusLabel: "Status unavailable",
    lastActivityAt: "2026-08-12T00:00:00Z",
    bucket: "unknown",
    ...overrides,
  };
}

test("collapses multiple blank-placeholder deals down to the most recent one", () => {
  const apps = [
    app({ id: "newest", lastActivityAt: "2026-08-12T22:36:00Z" }),
    app({ id: "middle", lastActivityAt: "2026-08-12T19:16:00Z" }),
    app({ id: "oldest", lastActivityAt: "2026-08-12T16:36:00Z" }),
  ];
  const result = collapseBlankDuplicates(apps);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "newest");
});

test("does NOT collapse a single blank application (nothing to dedupe)", () => {
  const apps = [app({ id: "only-one" })];
  const result = collapseBlankDuplicates(apps);
  assert.equal(result.length, 1);
});

test("never touches applications with a real, borrower-entered name", () => {
  const apps = [
    app({ id: "real-1", businessName: "Ramirez Coastal Coffee Co." }),
    app({ id: "real-2", businessName: "Buddy The Underwriter" }),
  ];
  const result = collapseBlankDuplicates(apps);
  assert.equal(result.length, 2, "legitimate applications must never be hidden");
});

test("collapses blanks while leaving real applications for the same borrower untouched", () => {
  const apps = [
    app({ id: "real", businessName: "Ramirez Coastal Coffee Co.", lastActivityAt: "2026-08-12T10:00:00Z" }),
    app({ id: "blank-newest", lastActivityAt: "2026-08-12T22:36:00Z" }),
    app({ id: "blank-oldest", lastActivityAt: "2026-08-12T16:36:00Z" }),
  ];
  const result = collapseBlankDuplicates(apps);
  const ids = result.map((a) => a.id).sort();
  assert.deepEqual(ids, ["blank-newest", "real"]);
});

test("does not mutate the input array reference count unexpectedly (pure function)", () => {
  const apps = [app({ id: "a" }), app({ id: "b" })];
  const originalLength = apps.length;
  collapseBlankDuplicates(apps);
  assert.equal(apps.length, originalLength, "input array must not be mutated");
});
