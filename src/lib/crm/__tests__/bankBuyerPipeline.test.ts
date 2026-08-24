import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260824193000_brokerage_bank_buyer_crm.sql", "utf8");
const api = readFileSync("src/lib/crm/bankBuyerRoute.ts", "utf8");
const page = readFileSync("src/components/brokerage/BankBuyersWorkspace.tsx", "utf8");
const organizationPage = readFileSync("src/components/brokerage/OrganizationWorkspace.tsx", "utf8");

test("bank buyer CRM owns a tenant-scoped multi-lender submission ledger", () => {
  assert.match(migration, /create table public\.crm_lender_profiles/);
  assert.match(migration, /create table public\.crm_deal_lender_submissions/);
  assert.match(migration, /unique \(bank_id, deal_id, lender_profile_id\)/);
  assert.match(migration, /enable row level security/g);
});

test("API gates access and records lifecycle history", () => {
  assert.match(api, /requireBrokerageStaff/);
  assert.match(api, /getBrokerageBankId/);
  assert.match(api, /crm_lender_submission_events/);
  assert.match(api, /decline reason is required/i);
  assert.match(api, /closed amount and date are required/i);
});

test("operator surface includes bank appetite, banker, placement, and closing workflows", () => {
  for (const copy of ["Bank buyer network", "Add a bank and its primary banker", "Send a deal", "Deal distribution ledger", "Final closed amount"]) assert.match(page, new RegExp(copy, "i"));
});


test("deal placement does not require a completed lending appetite", () => {
  assert.match(api, /ensure_buyer_relationship/);
  assert.match(api, /sba_7a_appetite:\s*false/);
  assert.match(page, /organizationId/);
  assert.match(organizationPage, /new=submission/);
  assert.match(organizationPage, /Appetite is optional/);
});