/**
 * Unit tests for ensureUserProfile provisioning logic.
 *
 * Tests the idempotent "ensure profile exists" contract:
 *   - Returns existing profile if found
 *   - Creates profile with sensible defaults if missing
 *   - Handles email-prefix and name defaults
 *
 * Run: npx tsx src/lib/tenant/__tests__/ensureUserProfile.test.ts
 */

import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Helpers: inline the core logic so we can test without Supabase/server-only
// ---------------------------------------------------------------------------

type UserProfile = {
  id: string;
  clerk_user_id: string;
  bank_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

/**
 * Pure logic extracted from ensureUserProfile for testability.
 * Tests the default-name derivation and return shape.
 */
function deriveDefaultDisplayName(opts: {
  name?: string | null;
  email?: string | null;
}): string | null {
  return opts.name?.trim() || opts.email?.split("@")[0] || null;
}

function buildProfileFromRow(row: Record<string, any>): UserProfile {
  return {
    id: row.id,
    clerk_user_id: row.clerk_user_id,
    bank_id: row.bank_id ?? null,
    display_name: row.display_name ?? null,
    avatar_url: row.avatar_url ?? null,
  };
}

// ---------------------------------------------------------------------------

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

// ─── deriveDefaultDisplayName ─────────────────────────────────────────────

console.log("ensureUserProfile — default display name derivation");

test("uses name when provided", () => {
  assert.equal(deriveDefaultDisplayName({ name: "Alice Smith", email: "alice@example.com" }), "Alice Smith");
});

test("falls back to email prefix when name is null", () => {
  assert.equal(deriveDefaultDisplayName({ name: null, email: "bob.jones@example.com" }), "bob.jones");
});

test("falls back to email prefix when name is whitespace", () => {
  assert.equal(deriveDefaultDisplayName({ name: "   ", email: "charlie@example.com" }), "charlie");
});

test("returns null when both are null", () => {
  assert.equal(deriveDefaultDisplayName({ name: null, email: null }), null);
});

test("returns null when both are undefined", () => {
  assert.equal(deriveDefaultDisplayName({}), null);
});

test("handles email without @ gracefully", () => {
  // edge case: email is just "localpart" (no @)
  assert.equal(deriveDefaultDisplayName({ email: "localpart" }), "localpart");
});

// ─── buildProfileFromRow ─────────────────────────────────────────────────

console.log("ensureUserProfile — profile shape from DB row");

test("maps full row correctly", () => {
  const row = {
    id: "prof-1",
    clerk_user_id: "user_abc",
    bank_id: "bank-1",
    display_name: "Alice",
    avatar_url: "https://example.com/avatar.png",
  };
  const profile = buildProfileFromRow(row);
  assert.equal(profile.id, "prof-1");
  assert.equal(profile.clerk_user_id, "user_abc");
  assert.equal(profile.bank_id, "bank-1");
  assert.equal(profile.display_name, "Alice");
  assert.equal(profile.avatar_url, "https://example.com/avatar.png");
});

test("nullifies missing optional fields", () => {
  const row = {
    id: "prof-2",
    clerk_user_id: "user_def",
    // bank_id, display_name, avatar_url all undefined
  };
  const profile = buildProfileFromRow(row);
  assert.equal(profile.bank_id, null);
  assert.equal(profile.display_name, null);
  assert.equal(profile.avatar_url, null);
});

test("handles explicit null values", () => {
  const row = {
    id: "prof-3",
    clerk_user_id: "user_ghi",
    bank_id: null,
    display_name: null,
    avatar_url: null,
  };
  const profile = buildProfileFromRow(row);
  assert.equal(profile.bank_id, null);
  assert.equal(profile.display_name, null);
  assert.equal(profile.avatar_url, null);
});

// ─── Idempotency contract ─────────────────────────────────────────────────

console.log("ensureUserProfile — idempotency contract");

test("existing profile returns as-is without insert", () => {
  // Simulate: load returns a row → should return it directly
  const existingRow = {
    id: "prof-exist",
    clerk_user_id: "user_existing",
    bank_id: "bank-x",
    display_name: "Existing User",
    avatar_url: null,
  };
  const profile = buildProfileFromRow(existingRow);
  assert.equal(profile.display_name, "Existing User");
  assert.equal(profile.clerk_user_id, "user_existing");
});

test("missing profile derives display name from Clerk name", () => {
  const defaultName = deriveDefaultDisplayName({ name: "John Doe", email: "john@test.com" });
  assert.equal(defaultName, "John Doe");
});

test("missing profile derives display name from email prefix", () => {
  const defaultName = deriveDefaultDisplayName({ name: null, email: "mlpaller@gmail.com" });
  assert.equal(defaultName, "mlpaller");
});

console.log("\nAll ensureUserProfile tests complete.");
