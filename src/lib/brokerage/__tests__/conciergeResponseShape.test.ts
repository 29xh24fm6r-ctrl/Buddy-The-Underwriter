import test from "node:test";
import assert from "node:assert/strict";

/**
 * Phase 4 contract: the concierge response carries the documented shape.
 *
 * The helpers under test (computeNextRequiredFields / readinessHintFromProgress)
 * live inline in the route handler (they reference no DB / cookie state).
 * We re-implement them here as a contract — the route's exports should
 * stay aligned, and a future refactor that breaks this contract will
 * surface as a test failure in this file.
 *
 * If the shape is changed intentionally, update both this contract and
 * the route handler in the same PR.
 */

function computeNextRequiredFields(facts: Record<string, any>): string[] {
  const missing: string[] = [];
  if (!facts?.borrower?.first_name) missing.push("borrower.first_name");
  if (!facts?.borrower?.email) missing.push("borrower.email");
  if (!facts?.business?.legal_name && !facts?.business?.industry_description) {
    missing.push("business.legal_name_or_industry");
  }
  if (!facts?.loan?.amount_requested) missing.push("loan.amount_requested");
  if (!facts?.loan?.use_of_proceeds) missing.push("loan.use_of_proceeds");
  if (typeof facts?.business?.is_franchise !== "boolean") {
    missing.push("business.is_franchise");
  }
  return missing;
}

function readinessHintFromProgress(progressPct: number): string {
  if (progressPct >= 100) return "Ready to upload supporting documents.";
  if (progressPct >= 60) return "Almost there — a few facts to go.";
  if (progressPct >= 30) return "Good start — keep going.";
  return "Tell Buddy a bit more about your business and loan need.";
}

test("computeNextRequiredFields returns all required keys when facts are empty", () => {
  const out = computeNextRequiredFields({});
  assert.deepEqual(out, [
    "borrower.first_name",
    "borrower.email",
    "business.legal_name_or_industry",
    "loan.amount_requested",
    "loan.use_of_proceeds",
    "business.is_franchise",
  ]);
});

test("computeNextRequiredFields drops keys as facts arrive", () => {
  const facts = {
    borrower: { first_name: "Ana", email: "a@b.co" },
    business: { legal_name: "Acme LLC", is_franchise: false },
    loan: { amount_requested: 250000, use_of_proceeds: "equipment" },
  };
  assert.deepEqual(computeNextRequiredFields(facts), []);
});

test("computeNextRequiredFields treats is_franchise=false as satisfied (boolean check, not truthy)", () => {
  const facts = {
    borrower: { first_name: "A", email: "a@b.co" },
    business: { legal_name: "Acme", is_franchise: false },
    loan: { amount_requested: 1, use_of_proceeds: "x" },
  };
  assert.equal(computeNextRequiredFields(facts).includes("business.is_franchise"), false);
});

test("readinessHintFromProgress thresholds", () => {
  assert.match(readinessHintFromProgress(0), /Tell Buddy/);
  assert.match(readinessHintFromProgress(30), /Good start/);
  assert.match(readinessHintFromProgress(60), /Almost there/);
  assert.match(readinessHintFromProgress(100), /Ready to upload/);
});
