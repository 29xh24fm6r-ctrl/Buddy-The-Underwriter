import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards on SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 migrations. If any of these
 * constructs disappear, the matching API will silently misbehave.
 */

const DEDUP = join(
  process.cwd(),
  "supabase/migrations/20260621000001_brokerage_session_dedup.sql",
);
const PORTAL = join(
  process.cwd(),
  "supabase/migrations/20260621000002_borrower_portal_link_state.sql",
);
const RLS_FWD = join(
  process.cwd(),
  "supabase/migrations/20260621000003_brokerage_rls_stage_a.sql",
);
const RLS_INV = join(
  process.cwd(),
  "supabase/rollback/20260621000003_brokerage_rls_stage_a_inverse.sql",
);

test("session-dedup migration: deals.brokerage_session_token_hash column + partial unique", () => {
  const sql = readFileSync(DEDUP, "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS brokerage_session_token_hash text/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS\s+deals_brokerage_anon_one_per_token[\s\S]+WHERE origin = 'brokerage_anonymous'/,
  );
});

test("session-dedup migration: claim_brokerage_session takes advisory lock + rechecks", () => {
  const sql = readFileSync(DEDUP, "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.claim_brokerage_session/);
  assert.match(sql, /pg_advisory_xact_lock\(/);
  assert.match(sql, /SELECT deal_id INTO v_deal_id[\s\S]+FROM public\.borrower_session_tokens/);
  assert.match(sql, /INSERT INTO public\.deals/);
  assert.match(sql, /INSERT INTO public\.borrower_session_tokens/);
});

test("portal-link migration: revoked_at column + both RPCs + state-machine errors", () => {
  const sql = readFileSync(PORTAL, "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS revoked_at timestamptz/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.peek_borrower_portal_link/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.consume_borrower_portal_link/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /'link_not_found'/);
  assert.match(sql, /'link_expired'/);
  assert.match(sql, /'link_consumed'/);
  assert.match(sql, /'link_revoked'/);
});

test("RLS Stage A migration enables both tables, inverse disables both", () => {
  const fwd = readFileSync(RLS_FWD, "utf8");
  assert.match(
    fwd,
    /ALTER TABLE public\.borrower_session_tokens ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    fwd,
    /ALTER TABLE public\.rate_limit_counters\s+ENABLE ROW LEVEL SECURITY/,
  );
  const inv = readFileSync(RLS_INV, "utf8");
  assert.match(
    inv,
    /ALTER TABLE public\.borrower_session_tokens DISABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    inv,
    /ALTER TABLE public\.rate_limit_counters\s+DISABLE ROW LEVEL SECURITY/,
  );
});
