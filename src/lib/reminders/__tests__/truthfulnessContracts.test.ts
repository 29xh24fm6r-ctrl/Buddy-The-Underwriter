import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("candidate selection fails closed when required checklist state is unavailable", () => {
  const src = source("src/lib/reminders/selectCandidates.ts");

  assert.match(src, /if \(itemsErr\)[\s\S]*throw new Error\("Failed to load reminder checklist state"\)/);
  assert.doesNotMatch(src, /if \(itemsErr\)[\s\S]{0,300}\bcontinue;/);
});

test("SMS success requires returned-row proof from both canonical ledgers", () => {
  const src = source("src/lib/sms/send.ts");

  assert.match(src, /outbound_messages[\s\S]*\.select\("id, provider_message_id, status"\)[\s\S]*\.single\(\)/);
  assert.match(src, /deal_events[\s\S]*\.select\("id, deal_id, kind, payload"\)[\s\S]*\.single\(\)/);
  assert.match(src, /throw new SmsDeliveryAuditError\(persistenceFailures\)/);
});

test("cron distinguishes suppression and audit uncertainty without returning full phones", () => {
  const src = source("src/app/api/cron/borrower-reminders/route.ts");

  assert.match(src, /reason: "comms_suppressed"/);
  assert.match(src, /action: "uncertain"/);
  assert.match(src, /borrowerPhoneLast4/);
  assert.doesNotMatch(src, /borrowerPhone:/);
  assert.doesNotMatch(src, /error: e\?\.message/);
});
