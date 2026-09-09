import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STARTER_MESSAGE_TEMPLATES } from "../starterMessageTemplates";

const read = (path: string) => readFileSync(path, "utf8");

test("starter message library covers every CRM trigger with email and SMS copy", () => {
  assert.equal(STARTER_MESSAGE_TEMPLATES.length, 13);
  assert.equal(new Set(STARTER_MESSAGE_TEMPLATES.map((item) => item.key)).size, 13);
  for (const item of STARTER_MESSAGE_TEMPLATES) {
    assert.ok(item.label && item.explanation && item.emailSubject && item.emailBody && item.smsBody);
  }
});

test("CRM task navigation retries until asynchronously rendered target exists", () => {
  const frame = read("src/components/brokerage/CrmWorkspaceFrame.tsx");
  assert.match(frame, /getElementById\("crm-tasks"\)/);
  assert.match(frame, /scrollIntoView/);
  assert.match(frame, /attempts\+\+ < 20/);
});

test("CRM route content remounts when the destination changes", () => {
  const frame = read("src/components/brokerage/CrmWorkspaceFrame.tsx");
  assert.match(frame, /key={`\$\{pathname\}\?\$\{query\.toString\(\)\}`}/);
});

test("relationship intelligence uses the CRM light palette", () => {
  const panel = read("src/components/brokerage/RelationshipIntelligencePanel.tsx");
  const css = read("src/app/admin/brokerage/crm/unified.css");
  assert.match(panel, /crmColors as c/);
  assert.match(panel, /crm-intelligence-panel/);
  assert.match(css, /\.crm-intelligence-panel span[\s\S]*#17263d/);
});

test("production certification checks schema and both durable journeys", () => {
  const workflow = read(".github/workflows/brokerage-production-certification.yml");
  const readiness = read("src/app/admin/brokerage/launch-readiness/page.tsx");
  assert.match(workflow, /Verify production schema contract/);
  assert.match(workflow, /claim_marketplace_listing/);
  assert.match(readiness, /golden_brokerage_run/);
  assert.match(readiness, /passRate >= 13 \/ 15/);
});
