import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const createRoute = readFileSync("src/app/api/admin/brokerage/deals/route.ts", "utf8");
const pipeline = readFileSync("src/app/admin/brokerage/pipeline/page.tsx", "utf8");
const detail = readFileSync("src/app/admin/brokerage/pipeline/[dealId]/LenderOutreachClient.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260828142253_harden_private_lender_crm_grants.sql", "utf8");

test("self-sourced intake is brokerage-authenticated and tenant-scoped", () => {
  assert.match(createRoute, /requireBrokerageStaff/);
  assert.match(createRoute, /getBrokerageBankId/);
  assert.match(createRoute, /external_deal_source:\s*"brokerage_self_sourced_package"/);
  assert.match(createRoute, /crm_tracking_only:\s*false/);
  assert.match(createRoute, /brokerage_stage:\s*"document_collection"/);
});

test("pipeline exposes intake and preserves the canonical deal workspace", () => {
  assert.match(pipeline, /Load self-sourced deal/);
  assert.match(pipeline, /\/admin\/brokerage\/pipeline\/new/);
  assert.match(createRoute, /deal_audit_log/);
  assert.match(createRoute, /deal_brokerage_stage_transitions/);
});

test("lender responses reuse the canonical bank buyer ledger", () => {
  assert.match(detail, /\/api\/admin\/brokerage\/crm\/organizations\/buyers/);
  assert.match(detail, /action:\s*"create_submission"/);
  assert.match(detail, /method:\s*"PATCH"|request\("PATCH"/);
  assert.match(detail, /required=\{status === "declined"\}/);
  assert.doesNotMatch(detail, /brokerage_lender_outreach/);
});

test("private lender CRM tables are explicitly unavailable to browser roles", () => {
  for (const table of ["crm_lender_profiles", "crm_deal_lender_submissions", "crm_lender_submission_events"]) {
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.match(migration, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
  }
});
