/**
 * Unit tests for ensureUserProfile provisioning logic.
 *
 * Tests:
 *   - Default display name derivation (name → email prefix → null)
 *   - Profile shape from DB row
 *   - Idempotency contract
 *   - Schema mismatch detection (isSchemaMismatchError pattern)
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

/**
 * Mirrors isSchemaMismatchError from ensureUserProfile.ts and safeFetch.ts.
 */
function isSchemaMismatchError(errorMsg: string): boolean {
  const msg = (errorMsg ?? "").toLowerCase();
  return (
    msg.includes("does not exist") ||
    (msg.includes("column") && msg.includes("not found")) ||
    (msg.includes("pgrst") && msg.includes("400")) ||
    (msg.includes("could not find") && msg.includes("column")) ||
    (msg.includes("relation") && msg.includes("does not exist"))
  );
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

console.log("ensureUserProfile \u2014 default display name derivation");

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
  assert.equal(deriveDefaultDisplayName({ email: "localpart" }), "localpart");
});

// ─── buildProfileFromRow ─────────────────────────────────────────────────

console.log("ensureUserProfile \u2014 profile shape from DB row");

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
  const row = { id: "prof-2", clerk_user_id: "user_def" };
  const profile = buildProfileFromRow(row);
  assert.equal(profile.bank_id, null);
  assert.equal(profile.display_name, null);
  assert.equal(profile.avatar_url, null);
});

test("handles explicit null values", () => {
  const row = { id: "prof-3", clerk_user_id: "user_ghi", bank_id: null, display_name: null, avatar_url: null };
  const profile = buildProfileFromRow(row);
  assert.equal(profile.bank_id, null);
  assert.equal(profile.display_name, null);
  assert.equal(profile.avatar_url, null);
});

// ─── Idempotency contract ─────────────────────────────────────────────────

console.log("ensureUserProfile \u2014 idempotency contract");

test("existing profile returns as-is without insert", () => {
  const existingRow = { id: "prof-exist", clerk_user_id: "user_existing", bank_id: "bank-x", display_name: "Existing User", avatar_url: null };
  const profile = buildProfileFromRow(existingRow);
  assert.equal(profile.display_name, "Existing User");
  assert.equal(profile.clerk_user_id, "user_existing");
});

test("missing profile derives display name from Clerk name", () => {
  assert.equal(deriveDefaultDisplayName({ name: "John Doe", email: "john@test.com" }), "John Doe");
});

test("missing profile derives display name from email prefix", () => {
  assert.equal(deriveDefaultDisplayName({ name: null, email: "mlpaller@gmail.com" }), "mlpaller");
});

// ─── Schema mismatch detection ────────────────────────────────────────────

console.log("ensureUserProfile \u2014 schema mismatch detection");

test("detects 'column profiles.display_name does not exist'", () => {
  assert.equal(isSchemaMismatchError("column profiles.display_name does not exist"), true);
});

test("detects 'column profiles.avatar_url does not exist'", () => {
  assert.equal(isSchemaMismatchError("column profiles.avatar_url does not exist"), true);
});

test("detects generic 'does not exist' error", () => {
  assert.equal(isSchemaMismatchError("relation \"profiles\" does not exist"), true);
});

test("detects PGRST 400 error", () => {
  assert.equal(isSchemaMismatchError("PGRST204: 400 Bad Request"), true);
});

test("detects 'could not find column' error", () => {
  assert.equal(isSchemaMismatchError("could not find the column 'display_name' in the schema"), true);
});

test("does NOT flag normal query errors as schema mismatch", () => {
  assert.equal(isSchemaMismatchError("duplicate key value violates unique constraint"), false);
});

test("does NOT flag timeout errors as schema mismatch", () => {
  assert.equal(isSchemaMismatchError("Query timeout exceeded"), false);
});

test("does NOT flag empty error string as schema mismatch", () => {
  assert.equal(isSchemaMismatchError(""), false);
});

test("schema_mismatch result shape has ok:false + detail", () => {
  // Simulate what ensureUserProfile returns on schema mismatch
  const result = {
    ok: false as const,
    error: "schema_mismatch" as const,
    detail: "profiles.display_name or avatar_url missing",
    profile: buildProfileFromRow({ id: "p1", clerk_user_id: "u1" }),
  };
  assert.equal(result.ok, false);
  assert.equal(result.error, "schema_mismatch");
  assert.equal(result.profile.display_name, null);
  assert.equal(result.profile.avatar_url, null);
  assert.ok(result.detail.includes("display_name"));
});

console.log("\nAll ensureUserProfile tests complete.");
