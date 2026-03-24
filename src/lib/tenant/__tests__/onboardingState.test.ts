/**
 * Unit tests for the canonical onboarding state model.
 *
 * Tests:
 *   - State derivation for all three canonical states
 *   - Redirect mapping
 *   - Edge cases (no memberships, multiple memberships)
 *
 * Run: npx tsx src/lib/tenant/__tests__/onboardingState.test.ts
 */

import assert from "node:assert/strict";
import { deriveOnboardingState, onboardingRedirect } from "../onboardingState";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e: any) {
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

// ─── deriveOnboardingState ─────────────────────────────────────────────────

console.log("onboardingState \u2014 state derivation");

test("no bank context → authenticated_no_bank_context", () => {
  const result = deriveOnboardingState({
    userId: "u1",
    bankId: null,
    hasProfile: false,
    membershipCount: 0,
  });
  assert.equal(result.state, "authenticated_no_bank_context");
});

test("bank context but no profile → authenticated_bank_context_no_profile", () => {
  const result = deriveOnboardingState({
    userId: "u1",
    bankId: "bank-1",
    hasProfile: false,
    membershipCount: 1,
  });
  assert.equal(result.state, "authenticated_bank_context_no_profile");
});

test("bank context + profile → authenticated_ready", () => {
  const result = deriveOnboardingState({
    userId: "u1",
    bankId: "bank-1",
    hasProfile: true,
    membershipCount: 1,
  });
  assert.equal(result.state, "authenticated_ready");
});

test("multiple memberships, no bank selected → authenticated_no_bank_context", () => {
  const result = deriveOnboardingState({
    userId: "u1",
    bankId: null,
    hasProfile: true,
    membershipCount: 3,
  });
  assert.equal(result.state, "authenticated_no_bank_context");
});

test("result shape includes all input fields", () => {
  const result = deriveOnboardingState({
    userId: "u42",
    bankId: "bank-x",
    hasProfile: true,
    membershipCount: 2,
  });
  assert.equal(result.userId, "u42");
  assert.equal(result.bankId, "bank-x");
  assert.equal(result.hasProfile, true);
  assert.equal(result.membershipCount, 2);
});

// ─── onboardingRedirect ────────────────────────────────────────────────────

console.log("onboardingState \u2014 redirect mapping");

test("no_bank_context → /select-bank", () => {
  assert.equal(onboardingRedirect("authenticated_no_bank_context"), "/select-bank");
});

test("bank_context_no_profile → /select-bank", () => {
  assert.equal(onboardingRedirect("authenticated_bank_context_no_profile"), "/select-bank");
});

test("ready → null (no redirect)", () => {
  assert.equal(onboardingRedirect("authenticated_ready"), null);
});

// ─── Invariants ────────────────────────────────────────────────────────────

console.log("onboardingState \u2014 invariants");

test("exactly three states exist (exhaustive type)", () => {
  const states = [
    "authenticated_no_bank_context",
    "authenticated_bank_context_no_profile",
    "authenticated_ready",
  ] as const;
  // Verify each produces a valid redirect result (no throw)
  for (const s of states) {
    const r = onboardingRedirect(s);
    assert.ok(r === null || typeof r === "string");
  }
  assert.equal(states.length, 3);
});

test("bank_id null always means no_bank_context regardless of profile", () => {
  const withProfile = deriveOnboardingState({ userId: "u1", bankId: null, hasProfile: true, membershipCount: 5 });
  const withoutProfile = deriveOnboardingState({ userId: "u1", bankId: null, hasProfile: false, membershipCount: 0 });
  assert.equal(withProfile.state, "authenticated_no_bank_context");
  assert.equal(withoutProfile.state, "authenticated_no_bank_context");
});

console.log("\nAll onboardingState tests complete.");
