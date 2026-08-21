import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sealStatus = readFileSync(
  "src/app/api/brokerage/deals/[dealId]/seal-status/route.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260821130000_database_reliability_hardening.sql",
  "utf8",
);

test("seal status reads SBA program from canonical intake models", () => {
  assert.doesNotMatch(
    sealStatus,
    /\.from\("deals"\)[\s\S]{0,120}\.select\("sba_program"\)/,
  );
  assert.match(sealStatus, /\.from\("deal_intake"\)/);
  assert.match(sealStatus, /\.from\("deal_loan_requests"\)/);
  assert.match(sealStatus, /rawSbaProgram\?\.toUpperCase\(\) === "504"/);
});

test("database hardening migration closes externally exposed QA operations", () => {
  assert.match(
    migration,
    /revoke all on function public\.create_qa_test_application[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public\.cleanup_test_data[\s\S]*from public, anon, authenticated/,
  );
  assert.match(migration, /to service_role/);
});

test("database hardening migration uses invoker views and cached auth context", () => {
  assert.equal(
    (migration.match(/security_invoker = true/g) ?? []).length,
    6,
  );
  assert.match(migration, /bm\.user_id = \(select auth\.uid\(\)\)/);
});
