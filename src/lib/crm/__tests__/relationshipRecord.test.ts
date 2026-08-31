import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isRelationshipTier,
  normalizeCustomFields,
  normalizeTags,
  RELATIONSHIP_TIERS,
} from "@/lib/crm/organizations";

const migration = readFileSync("supabase/migrations/20260831140000_crm_relationship_intelligence.sql", "utf8");
const triggers = readFileSync("src/lib/automation/triggers.ts", "utf8");
const lenderProfile = readFileSync("src/lib/crm/lenderProfile.ts", "utf8");
const crmHome = readFileSync("src/app/admin/brokerage/crm/page.tsx", "utf8");
const workspace = readFileSync("src/components/brokerage/OrganizationWorkspace.tsx", "utf8");

// ── tags ────────────────────────────────────────────────────────────────

test("tags are trimmed, deduped, and capped", () => {
  assert.deepEqual(normalizeTags(" marine , marine,  fast-close ,,"), ["marine", "fast-close"]);
  assert.deepEqual(normalizeTags(["a", "a", " b "]), ["a", "b"]);
  assert.deepEqual(normalizeTags(null), []);
  assert.equal(normalizeTags(Array.from({ length: 40 }, (_, i) => `t${i}`)).length, 24);
});

// ── custom fields ───────────────────────────────────────────────────────

test("custom fields stay a flat string map", () => {
  assert.deepEqual(normalizeCustomFields({ "Fee agreement": " signed 3/14 ", Officer: "Dana" }), {
    "Fee agreement": "signed 3/14",
    Officer: "Dana",
  });
  // Values are coerced so the column cannot become an arbitrary JSON tree.
  assert.deepEqual(normalizeCustomFields({ count: 3, flag: true }), { count: "3", flag: "true" });
  assert.deepEqual(normalizeCustomFields({ blank: "   ", "  ": "x", nothing: null }), {});
  assert.deepEqual(normalizeCustomFields(["not", "an", "object"]), {});
  assert.deepEqual(normalizeCustomFields(null), {});
});

test("custom fields are bounded in count and length", () => {
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, "v"]));
  assert.ok(Object.keys(normalizeCustomFields(many)).length <= 40);
  assert.equal(normalizeCustomFields({ k: "x".repeat(900) }).k.length, 500);
});

// ── tiers ───────────────────────────────────────────────────────────────

test("only the tiers the database allows are accepted", () => {
  for (const tier of RELATIONSHIP_TIERS) assert.equal(isRelationshipTier(tier), true);
  assert.equal(isRelationshipTier("platinum"), false);
  assert.equal(isRelationshipTier(null), false);
  // The check constraint and the code must list the same set.
  for (const tier of RELATIONSHIP_TIERS) assert.ok(migration.includes(`'${tier}'`), tier);
});

// ── the two halves of a bank ────────────────────────────────────────────

test("a lender-typed organization always gets its credit-box row", () => {
  // Production had four organizations and two banks because an org typed
  // 'lender' with no crm_lender_profiles row vanished from Bank buyers.
  assert.match(lenderProfile, /crm_lender_profiles/);
  assert.match(lenderProfile, /23505/); // a concurrent create is the desired end state
  const organizations = readFileSync("src/lib/crm/organizations.ts", "utf8");
  assert.match(organizations, /organizationType\s*\?\?\s*"referral_source"\)\s*===\s*"lender"/);
  assert.match(organizations, /patch\.organizationType === "lender"/);
});

// ── the staleness alert backlog ─────────────────────────────────────────

test("staleness alerts key on the episode, not the calendar day", () => {
  assert.match(triggers, /dedupeKey: `stale:\$\{p\.last_contacted_at \?\? "never"\}`/);
  assert.doesNotMatch(
    triggers.slice(triggers.indexOf("findReferralRelationshipStale")),
    /dedupeKey: new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/,
  );
  // And the rows the old key already wrote are collapsed.
  assert.match(migration, /delete from public\.crm_activities/);
  assert.match(migration, /Referral relationship has gone stale/);
});

// ── structured geography ────────────────────────────────────────────────

test("geography and industry appetite are stored as data, not prose", () => {
  for (const column of ["state_codes", "excluded_state_codes", "naics_codes", "excluded_naics_codes", "geography_mode"]) {
    assert.ok(migration.includes(column), `${column} is not added by the migration`);
  }
  // The legacy prose column is backfilled FROM, never dropped — migrations
  // in this repo are additive only.
  assert.doesNotMatch(migration, /drop column/i);
  assert.match(workspace, /StateMultiSelect/);
});

// ── the directory table ─────────────────────────────────────────────────

test("the directory table gives its columns room and shows owners", () => {
  // Without a column gap the right-aligned Contacts column butted into the
  // next header and the table read "CONTACTSLAST TOUCH".
  assert.match(crmHome, /const GRID_GAP = \d+;/);
  assert.match(crmHome, /columnGap: GRID_GAP/);
  assert.match(crmHome, /<div>Owner<\/div>/);
  assert.match(crmHome, /ownerFilter/);
  assert.match(crmHome, /tagFilter/);
});
