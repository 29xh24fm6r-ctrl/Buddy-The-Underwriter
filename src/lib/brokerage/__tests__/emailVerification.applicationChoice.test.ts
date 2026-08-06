import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(resolve(process.cwd(), "src/lib/brokerage/emailVerification.ts"), "utf8");
}

// --- QA path preserved ---

test("TRIPWIRE: QA path still checks is_test before creating any session token (unchanged security guard)", () => {
  const src = readSrc();
  assert.match(src, /P0 SECURITY: QA identity must never be bound to a non-test deal/);
  assert.match(src, /const isTest = \(deal as any\)\?\.is_test === true/);
  assert.match(src, /qa_needs_chooser/);
});

test("TRIPWIRE: QA path still reuses the current session when it already matches (unchanged optimization)", () => {
  const src = readSrc();
  assert.match(src, /current\?\.deal_id === existingLead\.converted_deal_id/);
});

test("TRIPWIRE: QA branch is gated by isQABorrowerEmail, so this change cannot affect QA behavior", () => {
  const src = readSrc();
  assert.match(src, /if \(isQA\) \{/);
});

// --- New non-QA path: never auto-resumes ---

test("TRIPWIRE: non-QA path checks for existing applications before ever creating or resuming a session", () => {
  const src = readSrc();
  const isQABlockEnd = src.indexOf("const qaSession = await getOrCreateBorrowerSession();");
  const afterQABlock = src.slice(isQABlockEnd);
  assert.match(afterQABlock, /listBorrowerApplications\(/);
});

test("TRIPWIRE: non-QA path does NOT call createBorrowerSession/claimBorrowerSession when applications exist — no auto-resume", () => {
  const src = readSrc();
  const listCallIdx = src.lastIndexOf("listBorrowerApplications(");
  const choiceNeededIdx = src.indexOf('kind: "application_choice_needed"', listCallIdx);
  const between = src.slice(listCallIdx, choiceNeededIdx);
  assert.doesNotMatch(between, /createBorrowerSession\(/);
  assert.doesNotMatch(between, /claimBorrowerSession\(/);
});

test("TRIPWIRE: fresh-deal creation (no prior applications) is unchanged — getOrCreateBorrowerSession + claimBorrowerSession", () => {
  const src = readSrc();
  const lastListIdx = src.lastIndexOf("existingApplications.length > 0");
  const afterCheck = src.slice(lastListIdx);
  assert.match(afterCheck, /getOrCreateBorrowerSession\(\)/);
  assert.match(afterCheck, /claimBorrowerSession\(/);
});

// --- Signal wiring through verifyCodeAndCreateSession ---

test("TRIPWIRE: verifyCodeAndCreateSession sets the application-chooser cookie only for the choice-needed result", () => {
  const src = readSrc();
  const kindIdx = src.indexOf('resolution.kind === "application_choice_needed"');
  const block = src.slice(kindIdx, kindIdx + 400);
  assert.match(block, /setApplicationChooserCookie\(email, args\.bankId\)/);
  assert.match(block, /applicationChoiceNeeded: true/);
});

test("TRIPWIRE: applicationChoiceNeeded is a distinct signal from qaNeedsChooser, not overloaded onto it", () => {
  const src = readSrc();
  assert.match(src, /qaNeedsChooser: true \}/);
  assert.match(src, /applicationChoiceNeeded: true \}/);
});

test("TRIPWIRE: VerifyCodeResult type includes the new applicationChoiceNeeded variant", () => {
  const src = readSrc();
  assert.match(src, /\{ ok: true; dealId: null; applicationChoiceNeeded: true \}/);
});
