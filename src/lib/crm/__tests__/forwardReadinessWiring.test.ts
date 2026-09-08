import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("every executive surface uses one authoritative operating snapshot", () => {
  const loader = read("src/lib/crm/loadRevenueOperatingSystem.ts");
  const api = read("src/app/api/admin/brokerage/crm/[...path]/_handlers/command-center.ts");
  const owner = read("src/app/admin/brokerage/owner/page.tsx");
  const home = read("src/app/admin/brokerage/page.tsx");

  assert.match(loader, /filter\(\(deal\) => !deal\.is_test\)/);
  assert.match(loader, /buildRevenueOperatingSystem/);
  assert.match(api, /loadRevenueOperatingSystem/);
  assert.match(owner, /loadRevenueOperatingSystem/);
  assert.match(home, /redirect\("\/admin\/brokerage\/crm"\)/);
  assert.doesNotMatch(home, /from\("deals"\)/);
});

test("owner command stays inside the brokerage workspace", () => {
  const shell = read("src/components/brokerage/BrokerageShell.tsx");
  const legacy = read("src/app/(app)/admin/brokerage-owner/page.tsx");
  assert.match(shell, /href: "\/admin\/brokerage\/owner"/);
  assert.match(legacy, /redirect\("\/admin\/brokerage\/owner"\)/);
});

test("production certification is explicit, identity-bound, and evidence preserving", () => {
  const workflow = read(".github/workflows/brokerage-production-certification.yml");
  const buildIdentityRoute = read("src/app/api/meta/build/route.ts");
  assert.match(workflow, /CERTIFY_PRODUCTION/);
  assert.match(workflow, /deployed_sha/);
  assert.match(buildIdentityRoute, /commitSha:/);
  assert.match(workflow, /JSON\.parse\(s\)\.commitSha/);
  assert.doesNotMatch(workflow, /JSON\.parse\(s\)\.gitSha/);
  assert.match(workflow, /BUDDY_BASE_URL: https:\/\/app\.buddytheunderwriter\.com/);
  assert.match(workflow, /synth:borrowers/);
  assert.match(workflow, /golden:brokerage -- --cleanup/);
  assert.match(workflow, /upload-artifact/);
});

test("schema reconciliation is repeat-safe and restores signing idempotency", () => {
  const migration = read("supabase/migrations/20260908173321_reconcile_signing_request_idempotency.sql");
  assert.match(migration, /column_name = 'idempotency_key'/i);
  assert.match(migration, /COLUMN idempotency_key/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_signing_requests_idempotency_key/i);
  assert.match(migration, /WHERE idempotency_key IS NOT NULL/i);
});
