import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SPEC-WELCOME-BACK-ZERO-APP-SESSION-1 — regression coverage for the
 * "Start a new application" button in the zero-applications ("not_found")
 * state of /welcome-back.
 *
 * Same source-tripwire convention already used for this codebase's other
 * borrower-auth flows (see applicationChooserScreen.test.ts,
 * emailVerification.applicationChoice.test.ts, routeAuth.test.ts) — no live
 * DOM/DB harness exists for this route, so these assert the exact source
 * shape rather than mount the component.
 */

function readSrc(): string {
  return readFileSync(
    resolve(process.cwd(), "src/app/(borrower)/welcome-back/WelcomeBackClient.tsx"),
    "utf8",
  );
}

// --- No second OTP: the zero-app "Start a new application" button no
// longer plain-navigates to /start; it POSTs to the application-choice
// endpoint using the identity already proven by the chooser cookie.

test("REGRESSION: zero-app state no longer uses a plain <a href=\"/start\"> for Start a new application", () => {
  const src = readSrc();
  const notFoundIdx = src.indexOf('step === "not_found"');
  const chooserIdx = src.indexOf('step === "code"');
  const block = src.slice(notFoundIdx, chooserIdx);
  assert.doesNotMatch(block, /<a\s+href="\/start"/);
});

test("REGRESSION: Start a new application calls startNewApplication, which POSTs action:\"new\" to /api/brokerage/session/applications", () => {
  const src = readSrc();
  const fnIdx = src.indexOf("async function startNewApplication()");
  assert.ok(fnIdx > -1);
  const nextFnIdx = src.indexOf("if (step ===", fnIdx);
  const fnBody = src.slice(fnIdx, nextFnIdx);
  assert.match(fnBody, /\/api\/brokerage\/session\/applications/);
  assert.match(fnBody, /action:\s*"new"/);

  const notFoundIdx = src.indexOf('step === "not_found"');
  const codeStepIdx = src.indexOf('step === "code"');
  const notFoundBlock = src.slice(notFoundIdx, codeStepIdx);
  assert.match(notFoundBlock, /onClick=\{\(\) => void startNewApplication\(\)\}/);
});

test("REGRESSION: startNewApplication never calls the email/OTP endpoint (action:\"send\" or action:\"verify\") — no second OTP", () => {
  const src = readSrc();
  const fnIdx = src.indexOf("async function startNewApplication()");
  const nextFnIdx = src.indexOf("if (step ===", fnIdx);
  const fnBody = src.slice(fnIdx, nextFnIdx);
  assert.doesNotMatch(fnBody, /action:\s*"send"/);
  assert.doesNotMatch(fnBody, /action:\s*"verify"/);
  assert.doesNotMatch(fnBody, /postSession\(/);
});

test("REGRESSION: on a successful response, startNewApplication navigates to /start (real session already minted server-side by then)", () => {
  const src = readSrc();
  const fnIdx = src.indexOf("async function startNewApplication()");
  const nextFnIdx = src.indexOf("if (step ===", fnIdx);
  const fnBody = src.slice(fnIdx, nextFnIdx);
  assert.match(fnBody, /window\.location\.href = "\/start"/);
});

test("REGRESSION: startNewApplication sends credentials so the application-chooser cookie is included on the request", () => {
  const src = readSrc();
  const fnIdx = src.indexOf("async function startNewApplication()");
  const nextFnIdx = src.indexOf("if (step ===", fnIdx);
  const fnBody = src.slice(fnIdx, nextFnIdx);
  assert.match(fnBody, /credentials:\s*"include"/);
});

test("REGRESSION: a failed start-new response surfaces an error and does NOT navigate away", () => {
  const src = readSrc();
  const fnIdx = src.indexOf("async function startNewApplication()");
  const nextFnIdx = src.indexOf("if (step ===", fnIdx);
  const fnBody = src.slice(fnIdx, nextFnIdx);
  const failBranchIdx = fnBody.indexOf("if (!res.ok || !data?.ok)");
  assert.ok(failBranchIdx > -1);
  const failBranchEndIdx = fnBody.indexOf("}", fnBody.indexOf("return;", failBranchIdx));
  const failBlock = fnBody.slice(failBranchIdx, failBranchEndIdx);
  assert.match(failBlock, /setError\(/);
  assert.doesNotMatch(failBlock, /window\.location\.href/);
});

// --- Preserved: "Try a different email" still resets to the email step,
// unaffected by the new Start New button ---

test("REGRESSION: 'Try a different email' still resets step/code/error and is unaffected by the new button", () => {
  const src = readSrc();
  const notFoundIdx = src.indexOf('step === "not_found"');
  const codeStepIdx = src.indexOf('step === "code"');
  const block = src.slice(notFoundIdx, codeStepIdx);
  assert.match(block, /setStep\("email"\)/);
  assert.match(block, /setCode\(""\)/);
});

// --- Frozen scope: this branch must not touch the concierge/chat fix ---

test("TRIPWIRE: concierge/chat source files are byte-unchanged references — this file has no import from the concierge route or gateway", () => {
  const src = readSrc();
  assert.doesNotMatch(src, /brokerage\/concierge/);
  assert.doesNotMatch(src, /borrowerConversation/);
  assert.doesNotMatch(src, /providers\/google/);
  assert.doesNotMatch(src, /CONCIERGE_TURN_RESPONSE_SCHEMA/);
});
