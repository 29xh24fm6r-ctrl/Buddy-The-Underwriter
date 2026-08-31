import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const createRoute = readFileSync("src/app/api/admin/brokerage/deals/route.ts", "utf8");
const intakeForm = readFileSync("src/app/admin/brokerage/pipeline/new/SelfSourcedDealForm.tsx", "utf8");
const board = readFileSync("src/app/admin/brokerage/pipeline/PipelineBoard.tsx", "utf8");
const pipeline = readFileSync("src/app/admin/brokerage/pipeline/page.tsx", "utf8");
const workspace = readFileSync("src/app/admin/brokerage/pipeline/[dealId]/DealWorkspaceClient.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260828142253_harden_private_lender_crm_grants.sql", "utf8");

test("deal intake is brokerage-authenticated and tenant-scoped", () => {
  assert.match(createRoute, /requireBrokerageStaff/);
  assert.match(createRoute, /getBrokerageBankId/);
  assert.match(createRoute, /deal_audit_log/);
  assert.match(createRoute, /deal_brokerage_stage_transitions/);
});

test("one front door names how the deal arrived instead of inferring it", () => {
  // The two rival flows produced differently-shaped rows in the same table
  // and were told apart only by a boolean plus a free-text source string.
  assert.match(createRoute, /intake_mode: intakeMode/);
  assert.match(createRoute, /crm_tracking_only: trackingOnly/);
  for (const mode of ["self_sourced", "referred", "inbound_portal", "tracking_only"]) {
    assert.ok(createRoute.includes(`"${mode}"`), `intake mode ${mode} is not accepted`);
  }
});

test("intake creates the CRM side of the deal in the same submit", () => {
  assert.match(createRoute, /createOrganization\(/);
  assert.match(createRoute, /from\("crm_people"\)/);
  assert.match(createRoute, /from\("deal_source_attribution"\)/);
  // The referral source is an external party role; 'borrower' is not a valid
  // deal_party_roles.role and the borrower is carried by deals.borrower_id.
  assert.match(createRoute, /role: "referral_source"/);
  assert.doesNotMatch(createRoute, /role: "borrower"/);
});

test("the financials attach through the canonical ingest path, not a new writer", () => {
  assert.match(intakeForm, /directDealDocumentUpload/);
  assert.doesNotMatch(createRoute, /from\("deal_documents"\)/);
});

test("the pipeline is a staged board with owners, banks, and next actions", () => {
  assert.match(board, /\/admin\/brokerage\/pipeline\/new/);
  assert.match(pipeline, /brokerage_stage_owner_clerk_user_id/);
  assert.match(pipeline, /crm_deal_lender_submissions/);
  assert.match(pipeline, /brokerage_tasks/);
  assert.match(board, /BOARD_COLUMNS/);
  // Assignment reaches the endpoint that already existed and had no caller.
  assert.match(board, /\/execution/);
  assert.match(board, /ownerClerkUserId/);
});

test("the deal workspace ranks banks and records distribution on the canonical ledger", () => {
  assert.match(workspace, /\/api\/admin\/brokerage\/crm\/organizations\/buyers/);
  assert.match(workspace, /lender-matches/);
  assert.match(workspace, /action: "create_submissions"/);
  assert.match(workspace, /action: "create_task"/);
  assert.match(workspace, /action: "transition_stage"/);
  assert.doesNotMatch(workspace, /brokerage_lender_outreach/);
});

test("private lender CRM tables are explicitly unavailable to browser roles", () => {
  for (const table of ["crm_lender_profiles", "crm_deal_lender_submissions", "crm_lender_submission_events"]) {
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.match(migration, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
  }
});
