import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: the marketplace claims/picks migration must contain the invariants
 * the application code relies on. If any of these constructs disappear, the
 * matching claim/pick API will silently misbehave at runtime.
 */
const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260620000000_marketplace_claims_and_picks.sql",
);

const sql = readFileSync(MIGRATION_PATH, "utf8");

test("defines marketplace_lender_claims with one-row-per-(listing,lender) unique", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.marketplace_lender_claims/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS marketplace_lender_claims_listing_lender_unique[\s\S]*\(listing_id, lender_bank_id\)/,
  );
});

test("defines marketplace_borrower_picks with exactly-one-active-per-listing", () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.marketplace_borrower_picks/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS marketplace_borrower_picks_one_active_per_listing[\s\S]*WHERE reverted_at IS NULL/,
  );
});

test("claim function enforces 3-claim cap, matched-lender, and listing-open window", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.claim_marketplace_listing/);
  assert.match(sql, /v_active_count >= 3/);
  assert.match(sql, /'claim_cap_reached'/);
  assert.match(sql, /'listing_not_open'/);
  assert.match(sql, /'not_matched'/);
  assert.match(sql, /'duplicate_claim'/);
});

test("pick function marks winner won, others lost, and flips listing to picked", () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.pick_marketplace_winner/);
  assert.match(sql, /SET status = 'lost'/);
  assert.match(sql, /SET status = 'won'/);
  assert.match(sql, /SET status = 'picked'/);
  assert.match(sql, /'winner_has_no_claim'/);
});

test("RLS is enabled on both tables", () => {
  assert.match(
    sql,
    /ALTER TABLE public\.marketplace_lender_claims ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    sql,
    /ALTER TABLE public\.marketplace_borrower_picks ENABLE ROW LEVEL SECURITY/,
  );
});

test("brokerage ops can read claims; lenders see only their own", () => {
  assert.match(sql, /lender_claims_select_for_brokerage_ops/);
  assert.match(sql, /lender_claims_select_for_owning_lender/);
});
