// SPEC-13.5 PR-B B-1 — guard tests for the consolidated /memo-inputs
// dispatcher's `postFromWizard` handler.
//
// Pins two contract changes:
//   1. The handler passes trustedBankId: bankId to both upsert helpers
//      (closing the same redundant access-check gap PR-A fixed in
//      migrateLegacyOverridesAsync).
//   2. The handler emits a memo_input.wizard_save audit event on every
//      write so we can observe canonical-write volume independently of
//      the deprecated_endpoint_hit shim telemetry added in B-4.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC_PATH = path.join(
  process.cwd(),
  "src/app/api/deals/[dealId]/memo-inputs/route.ts",
);
const SRC = fs.readFileSync(SRC_PATH, "utf-8");

function postFromWizardBody(): string {
  const fnIdx = SRC.indexOf("async function postFromWizard");
  assert.ok(fnIdx > 0, "postFromWizard must exist");
  // Walk past the parameter list (which itself contains `{ ... }` for the
  // inline body type) using a paren depth counter. THEN find the function
  // body opening brace.
  const parenStart = SRC.indexOf("(", fnIdx);
  let parenDepth = 0;
  let parenEnd = parenStart;
  for (let i = parenStart; i < SRC.length; i++) {
    if (SRC[i] === "(") parenDepth += 1;
    else if (SRC[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  const bodyOpen = SRC.indexOf("{", parenEnd);
  let depth = 0;
  for (let i = bodyOpen; i < SRC.length; i++) {
    if (SRC[i] === "{") depth += 1;
    else if (SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) return SRC.slice(fnIdx, i + 1);
    }
  }
  throw new Error("postFromWizard body did not close");
}

test("[postFromWizard.trustedBankId-1] borrower_story upsert receives trustedBankId", () => {
  const body = postFromWizardBody();
  const idx = body.indexOf("upsertBorrowerStory({");
  assert.ok(idx > 0, "upsertBorrowerStory must be called");
  const callBlock = body.slice(idx, idx + 600);
  assert.match(
    callBlock,
    /trustedBankId:\s*bankId/,
    "borrower_story upsert must pass trustedBankId from the resolved bankId",
  );
});

test("[postFromWizard.trustedBankId-2] management_profile upsert receives trustedBankId", () => {
  const body = postFromWizardBody();
  const idx = body.indexOf("upsertManagementProfile({");
  assert.ok(idx > 0, "upsertManagementProfile must be called");
  const callBlock = body.slice(idx, idx + 600);
  assert.match(
    callBlock,
    /trustedBankId:\s*bankId/,
    "management_profile upsert must pass trustedBankId from the resolved bankId",
  );
});

test("[postFromWizard.audit-1] writeEvent imported from canonical ledger module", () => {
  assert.match(
    SRC,
    /import\s*\{\s*writeEvent\s*\}\s*from\s*["']@\/lib\/ledger\/writeEvent["']/,
    "memo-inputs route must import writeEvent",
  );
});

test("[postFromWizard.audit-2] emits memo_input.wizard_save event", () => {
  const body = postFromWizardBody();
  assert.ok(
    body.includes("memo_input.wizard_save"),
    "postFromWizard must emit a memo_input.wizard_save audit event",
  );
});

test("[postFromWizard.audit-3] event payload includes spec-required fields", () => {
  const body = postFromWizardBody();
  const kindIdx = body.indexOf('"memo_input.wizard_save"');
  assert.ok(kindIdx > 0);
  // Locate the enclosing writeEvent({ ... }) and slice it.
  const callStart = body.lastIndexOf("writeEvent({", kindIdx);
  let depth = 0;
  let endIdx = callStart;
  for (let i = callStart; i < body.length; i++) {
    if (body[i] === "{") depth += 1;
    else if (body[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  const block = body.slice(callStart, endIdx + 1);
  assert.ok(block.includes("bank_id"), "event must include bank_id");
  assert.ok(
    block.includes("payload_keys"),
    "event must include payload_keys for observability",
  );
  assert.ok(
    block.includes("borrower_story_written"),
    "event must include borrower_story_written outcome",
  );
  assert.ok(
    block.includes("management_writes"),
    "event must include management_writes count",
  );
});

test("[postFromWizard.audit-4] event fires AFTER both upserts", () => {
  const body = postFromWizardBody();
  const lastUpsertIdx = Math.max(
    body.lastIndexOf("upsertBorrowerStory("),
    body.lastIndexOf("upsertManagementProfile("),
  );
  const writeEventIdx = body.indexOf('"memo_input.wizard_save"');
  assert.ok(
    writeEventIdx > lastUpsertIdx,
    "memo_input.wizard_save must fire after the upsert calls so the event payload reflects actual outcomes",
  );
});
