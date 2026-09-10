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
  assert.match(home, /return null/);
  assert.doesNotMatch(home, /redirect\(/);
  assert.doesNotMatch(home, /from\("deals"\)/);
});

test("owner command stays inside the brokerage workspace", () => {
  const shell = read("src/components/brokerage/BrokerageShell.tsx");
  const legacy = read("src/app/(app)/admin/brokerage-owner/page.tsx");
  const owner = read("src/app/admin/brokerage/owner/page.tsx");
  const crmFrame = read("src/components/brokerage/CrmWorkspaceFrame.tsx");
  assert.match(shell, /href: "\/admin\/brokerage\/owner"/);
  assert.match(legacy, /redirect\("\/admin\/brokerage\/owner"\)/);
  assert.match(owner, /CrmWorkspaceFrame/);
  assert.doesNotMatch(owner, /className="crm-unified/);
  assert.match(crmFrame, /className="crm-admin-return" href="\/admin\/brokerage"/);
  assert.match(crmFrame, /className="crm-admin-home-link" href="\/admin\/brokerage"/);
  assert.match(crmFrame, />Brokerage HQ</);
});

test("production certification is explicit, identity-bound, and evidence preserving", () => {
  const workflow = read(".github/workflows/brokerage-production-certification.yml");
  const buildIdentityRoute = read("src/app/api/meta/build/route.ts");
  assert.match(workflow, /CERTIFY_PRODUCTION/);
  assert.match(workflow, /deployed_sha/);
  assert.match(buildIdentityRoute, /commitSha:/);
  assert.match(workflow, /JSON\.parse\(s\)\.commitSha/);
  assert.doesNotMatch(workflow, /JSON\.parse\(s\)\.gitSha/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /environment: Production/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(workflow, /BUDDY_BASE_URL: https:\/\/app\.buddytheunderwriter\.com/);
  assert.match(workflow, /synth:borrowers/);
  assert.match(workflow, /golden:brokerage -- --cleanup/);
  assert.match(workflow, /upload-artifact/);
});

test("production certification database work stays behind scoped OIDC", () => {
  const dispatcher = read("src/app/api/ops/[...path]/route.ts");
  const finalize = read("src/app/api/ops/[...path]/_handlers/certification-finalize.ts");
  const golden = read("src/app/api/ops/[...path]/_handlers/golden-run.ts");
  const verifier = read("src/lib/auth/githubActionsOidcClaims.ts");
  assert.match(dispatcher, /certification\/finalize/);
  assert.match(dispatcher, /golden-run/);
  assert.match(finalize, /verifyBrokerageCertificationOidc/);
  assert.match(golden, /hasValidBrokerageCertificationOidc/);
  assert.match(verifier, /refs\/heads\/main/);
  assert.match(verifier, /environment:Production/);
});

test("borrower certification validates the journey it actually performs", () => {
  const runner = read("scripts/synth-borrower-e2e.ts");
  assert.match(runner, /status_verified/);
  assert.match(runner, /gate_reasons/);
  assert.match(runner, /invalid_seal_status_contract/);
  assert.doesNotMatch(runner, /seal_timeout/);
  assert.doesNotMatch(runner, /SYNTH_POLL_MAX_ATTEMPTS/);
  assert.match(runner, /response\.status !== 429/);
  assert.match(runner, /response\.headers\.get\("retry-after"\)/);
  assert.match(runner, /rate limited; pacing \$\{operation\}/);
  assert.match(runner, /fetchWithRateLimitPacing\([\s\S]*?upload\/prepare/);
  assert.match(runner, /"upload preparation"/);
});

test("schema reconciliation is repeat-safe and restores signing idempotency", () => {
  const migration = read("supabase/migrations/20260908173321_reconcile_signing_request_idempotency.sql");
  assert.match(migration, /column_name = 'idempotency_key'/i);
  assert.match(migration, /COLUMN idempotency_key/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_signing_requests_idempotency_key/i);
  assert.match(migration, /WHERE idempotency_key IS NOT NULL/i);
});

test("production schema reconciliation is deliberate and verifies the repair", () => {
  const workflow = read(".github/workflows/brokerage-schema-reconcile.yml");
  assert.match(workflow, /RECONCILE_BROKERAGE_SCHEMA/);
  assert.match(workflow, /environment: Production/);
  assert.match(workflow, /DRIFT_DETECT_DB_URL/);
  assert.match(workflow, /ux_signing_requests_idempotency_key/);
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/);
});
