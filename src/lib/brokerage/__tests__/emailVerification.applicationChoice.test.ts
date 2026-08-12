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

test("TRIPWIRE: verifyCodeAndCreateSession sets the application-chooser cookie for the choice-needed result", () => {
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

// --- SPEC-WELCOME-BACK-ZERO-APP-SESSION-1: zero applications ---

test("REGRESSION: zero applications ALSO sets the application-chooser cookie (same mechanism as choice-needed) — fixes forced re-verification", () => {
  const src = readSrc();
  const kindIdx = src.indexOf('resolution.kind === "no_applications"');
  assert.ok(kindIdx > -1);
  const block = src.slice(kindIdx, kindIdx + 400);
  assert.match(block, /setApplicationChooserCookie\(email, args\.bankId\)/);
  assert.match(block, /noApplicationsFound: true/);
});

test("REGRESSION: no new cookie/auth mechanism was introduced — no_applications reuses the exact same setApplicationChooserCookie call as choice-needed", () => {
  const src = readSrc();
  const occurrences = (src.match(/setApplicationChooserCookie\(email, args\.bankId\)/g) || []).length;
  assert.equal(occurrences, 2, "exactly the choice-needed branch and the no_applications branch, no new cookie helper");
  assert.doesNotMatch(src, /setNoApplicationsCookie|setZeroAppCookie|new.*Cookie.*Zero/i);
});

test("REGRESSION: no deal/session is created merely by verifying an email with zero applications (no auto-create on sign-in)", () => {
  const src = readSrc();
  const kindIdx = src.indexOf('resolution.kind === "no_applications"');
  const nextBlockIdx = src.indexOf("return { ok: true, dealId: resolution.dealId };");
  const block = src.slice(kindIdx, nextBlockIdx);
  assert.doesNotMatch(block, /createBorrowerSession\(/);
  assert.doesNotMatch(block, /claimBorrowerSession\(/);
  assert.doesNotMatch(block, /getOrCreateBorrowerSession\(/);
});

test("REGRESSION: resolveOrCreateVerifiedBorrowerSession's own no_applications branch (welcome-back mode) still returns before any session creation", () => {
  const src = readSrc();
  const modeCheckIdx = src.indexOf('if (args.mode === "welcome-back")');
  assert.ok(modeCheckIdx > -1);
  const blockEndIdx = src.indexOf("}", src.indexOf("no_applications", modeCheckIdx));
  const block = src.slice(modeCheckIdx, blockEndIdx);
  assert.match(block, /kind: "no_applications"/);
  assert.doesNotMatch(block, /getOrCreateBorrowerSession\(/);
});
