import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(): string {
  return readFileSync(
    resolve(process.cwd(), "src/app/api/brokerage/session/applications/route.ts"),
    "utf8",
  );
}

// --- Auth required for every action ---

test("TRIPWIRE: GET requires a valid application-chooser identity before listing anything", () => {
  const src = readSrc();
  const getIdx = src.indexOf("export async function GET");
  const postIdx = src.indexOf("export async function POST");
  const getBody = src.slice(getIdx, postIdx);
  assert.match(getBody, /getApplicationChooserIdentity\(\)/);
  assert.match(getBody, /if \(!identity\)/);
  assert.match(getBody, /status: 401/);
});

test("TRIPWIRE: POST requires a valid application-chooser identity before any action, including 'new'", () => {
  const src = readSrc();
  const postIdx = src.indexOf("export async function POST");
  const body = src.slice(postIdx);
  const identityCheckIdx = body.indexOf("getApplicationChooserIdentity()");
  const newActionIdx = body.indexOf('body.action === "new"');
  assert.ok(identityCheckIdx > -1 && newActionIdx > -1);
  assert.ok(identityCheckIdx < newActionIdx, "identity must be verified before the 'new' branch runs");
});

// --- Never trust client-supplied dealId alone ---

test("TRIPWIRE: resume/view re-fetches the deal server-side and checks borrower_email before proceeding", () => {
  const src = readSrc();
  assert.match(src, /\.from\("deals"\)/);
  assert.match(src, /borrower_email\?\.toLowerCase\(\) !== identity\.email/);
  assert.match(src, /"email_mismatch"/);
});

test("TRIPWIRE: resume/view checks bank_id against the verified identity's bankId", () => {
  const src = readSrc();
  assert.match(src, /d\.bank_id !== identity\.bankId/);
  assert.match(src, /"bank_mismatch"/);
});

test("TRIPWIRE: the requested action is checked against the deal's real status bucket, not trusted from the client", () => {
  const src = readSrc();
  assert.match(src, /listBorrowerApplications\(/);
  assert.match(src, /body\.action === "resume" && bucket !== "active"/);
  assert.match(src, /body\.action === "view" && bucket !== "completed"/);
});

test("TRIPWIRE: resume is rejected for a non-active bucket (e.g. completed) — cannot be reopened via this route", () => {
  const src = readSrc();
  assert.match(src, /"resume_not_allowed"/);
});

test("TRIPWIRE: view is rejected for a non-completed bucket — cannot bypass resume auth via view", () => {
  const src = readSrc();
  assert.match(src, /"view_not_allowed"/);
});

// --- New package isolation ---

test("TRIPWIRE: 'new' action uses the existing fresh-deal creation path, not a copy/clone of any prior deal", () => {
  const src = readSrc();
  const newIdx = src.indexOf('body.action === "new"');
  const block = src.slice(newIdx, newIdx + 400);
  assert.match(block, /getOrCreateBorrowerSession\(\)/);
  assert.match(block, /claimBorrowerSession\(/);
  // No deal-copy helper of any kind is referenced anywhere in this file.
  assert.doesNotMatch(src, /copyDeal|cloneDeal|duplicateDeal/i);
});

test("TRIPWIRE: 'new' action identity comes only from the verified chooser cookie, never from the request body", () => {
  const src = readSrc();
  const newIdx = src.indexOf('body.action === "new"');
  const block = src.slice(newIdx, newIdx + 400);
  assert.match(block, /identity\.email/);
  assert.doesNotMatch(block, /body\.email/);
});

// --- Session finalization ---

test("TRIPWIRE: successful resume/view/new all clear the chooser cookie after creating the real session", () => {
  const src = readSrc();
  const occurrences = (src.match(/clearApplicationChooserCookie\(\)/g) || []).length;
  assert.ok(occurrences >= 2, "chooser cookie must be cleared on both the resume/view path and the new path");
});

test("TRIPWIRE: every successful path calls the canonical createBorrowerSession/claimBorrowerSession, no ad hoc session write", () => {
  const src = readSrc();
  assert.match(src, /createBorrowerSession\(/);
  assert.match(src, /claimBorrowerSession\(/);
  assert.doesNotMatch(src, /\.from\("borrower_session_tokens"\)\.insert/);
});

// --- Audit logging ---

test("TRIPWIRE: resume, view, new, and rejected decisions are all logged", () => {
  const src = readSrc();
  assert.match(src, /auditLog\(\{\s*action: "new"/);
  assert.match(src, /auditLog\(\{\s*action: body\.action/);
  assert.match(src, /auditLog\(\{[\s\S]*?action: "rejected"/);
});

// --- Malformed input ---

test("TRIPWIRE: missing dealId on resume/view returns a clear 400, not a crash or silent success", () => {
  const src = readSrc();
  assert.match(src, /"deal_id_required"/);
  assert.match(src, /status: 400/);
});

test("TRIPWIRE: unknown action returns 400, never falls through to a default deal", () => {
  const src = readSrc();
  assert.match(src, /"unknown_action"/);
});
