import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

test("intake finalization remains behind the tenant-authorized server route", () => {
  const route = read("src/app/api/deals/[dealId]/intake/confirm/route.ts");
  assert.match(route, /ensureDealBankAccess\(dealId\)/);
  assert.match(route, /const sb = supabaseAdmin\(\)/);
  assert.match(route, /finalize_intake_and_enqueue_processing/);
});

test("intake SECURITY DEFINER RPC is executable only by service_role", () => {
  const migration = read(
    "supabase/migrations/20260827011000_finalize_intake_privilege_boundary.sql",
  );
  const signature =
    /public\.finalize_intake_and_enqueue_processing\(\s*uuid,\s*text,\s*uuid,\s*text,\s*text,\s*text,\s*integer\s*\)/i;

  assert.match(migration, signature);
  assert.match(migration, /set search_path = public, pg_temp/i);
  assert.match(migration, /revoke all[\s\S]*from public/i);
  assert.match(migration, /revoke all[\s\S]*from anon/i);
  assert.match(migration, /revoke all[\s\S]*from authenticated/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon/i);
});
