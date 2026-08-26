import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20260824193000_brokerage_bank_buyer_crm.sql", "utf8");
const marketplaceMigration = readFileSync("supabase/migrations/20260825190000_crm_marketplace_relationship_ux.sql", "utf8");
const externalDealMigration = readFileSync("supabase/migrations/20260825210000_crm_external_deal_tracking.sql", "utf8");
const api = readFileSync("src/lib/crm/bankBuyerRoute.ts", "utf8");
const page = readFileSync("src/components/brokerage/BankBuyersWorkspace.tsx", "utf8");
const organizationPage = readFileSync("src/components/brokerage/OrganizationWorkspace.tsx", "utf8");
const tokens = readFileSync("src/components/brokerage/tokens.ts", "utf8");
const shell = readFileSync("src/components/brokerage/BrokerageShell.tsx", "utf8");
const crmHome = readFileSync("src/app/admin/brokerage/crm/page.tsx", "utf8");
const crmTabs = readFileSync("src/components/brokerage/CrmTabs.tsx", "utf8");

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
  for (const copy of ["Bank buyer network", "Add a bank relationship", "Send a deal", "Deal distribution ledger", "Final closed amount"]) assert.match(page, new RegExp(copy, "i"));
});


test("deal placement does not require a completed lending appetite", () => {
  assert.match(api, /ensure_buyer_relationship/);
  assert.match(api, /sba_7a_appetite:\s*false/);
  assert.match(page, /organizationId/);
  assert.match(organizationPage, /new=submission/);
  assert.match(organizationPage, /Appetite is optional/);
});

test("marketplace participation is explicit and separate from optional appetite", () => {
  assert.match(marketplaceMigration, /marketplace_role/);
  assert.match(marketplaceMigration, /buyer_seller/);
  assert.match(marketplaceMigration, /marketplace_access_status/);
  assert.match(api, /update_marketplace_profile/);
  assert.match(organizationPage, /Marketplace participation/);
  assert.match(organizationPage, /independent from lending appetite/i);
  assert.match(page, /Marketplace role \(optional\)/);
});

test("bank records keep contacts, marketplace access, appetite, and deals in one workspace", () => {
  assert.match(organizationPage, /Add a banker or contact/);
  assert.match(organizationPage, /Marketplace Buyer/);
  assert.match(organizationPage, /Lending appetite/);
  assert.match(organizationPage, /Deals sent to this bank/);
  assert.match(organizationPage, /No duplicate organization is needed/);
});


test("CRM uses a scoped high-contrast light theme", () => {
  assert.match(tokens, /export const crmColors/);
  assert.match(tokens, /ink: "#F7F5F0"/);
  assert.match(tokens, /card: "#FFFFFF"/);
  assert.match(tokens, /paper: "#20242B"/);
  assert.match(shell, /pathname\.startsWith\("\/admin\/brokerage\/crm"\) \? crmColors : brokerageColors/);
  assert.match(page, /crmColors as c/);
  assert.match(organizationPage, /crmColors as c/);
});

// Live commissioning regression: handed-to-broker deals must not require Buddy intake.
test("off-platform deals can be recorded directly in the bank submission ledger", () => {
  assert.match(externalDealMigration, /crm_tracking_only/);
  assert.match(externalDealMigration, /external_deal_source/);
  assert.match(externalDealMigration, /external_reference/);
  assert.match(api, /create_external_submission/);
  assert.match(api, /crm_tracking_only:\s*true/);
  assert.match(api, /entry_mode:\s*"external_crm"/);
  assert.match(api, /\.delete\(\)\.eq\("id", deal\.id\)/);
  assert.match(page, /Enter off-platform deal/);
  assert.match(page, /Deal \/ business name \*/);
  assert.match(page, /lightweight CRM-only record/);
});

test("CRM navigation and activity stay clear on every nested workspace", () => {
  assert.match(shell, /sort\(\(\[a\], \[b\]\) => b\.length - a\.length\)/);
  assert.match(shell, /it\.href === "\/admin\/brokerage"/);
  assert.match(crmTabs, /Contacts/);
  assert.match(crmTabs, /Deal partners/);
  assert.match(crmTabs, /aria-current/);
  assert.match(crmHome, /Choose relationship type/);
  assert.match(crmHome, /displayActivity/);
  assert.match(crmHome, /seen\.has\(key\)/);
});

test("deal distribution is searchable, test-safe, and banker-scoped", () => {
  assert.match(page, /Search Buddy deals/);
  assert.match(page, /visibleDeals/);
  assert.match(page, /deal\.is_test/);
  assert.match(page, /soleBankerId/);
  assert.match(api, /is_test/);
  assert.match(api, /Selected banker is not associated with this bank/);
  assert.match(api, /eq\("organization_id", profile\.organization_id\)/);
});
