import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const templates = readFileSync("src/app/admin/brokerage/crm/templates/page.tsx", "utf8");
const organization = readFileSync("src/components/brokerage/OrganizationWorkspace.tsx", "utf8");
const observer = readFileSync("src/buddy/ui/BuddyPanel.tsx", "utf8");

test("message library progressively discloses the templates users need", () => {
  for (const label of ["Start here", "Borrower journey", "Lender placement", "Referral relationships", "Needs review"]) {
    assert.match(templates, new RegExp(label));
  }
  assert.match(templates, /channels ready/);
});

test("relationship activity and builder controls stay understandable and unobtrusive", () => {
  assert.match(organization, /Record activity or set a follow-up/);
  assert.match(organization, /Note, call, meeting, or task/);
  assert.match(observer, /pathname\?\.startsWith\("\/admin\/brokerage\/crm"\)/);
  assert.match(observer, /window\.innerWidth/);
});
