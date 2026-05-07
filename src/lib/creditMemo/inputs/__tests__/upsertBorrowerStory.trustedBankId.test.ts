// SPEC-13.5 A-2 / A-6 — guard tests for `trustedBankId` on upsertBorrowerStory.
//
// Source-pattern guards (no DB, no Clerk session). The spec's Risk #2 makes
// the security comment around `trustedBankId` load-bearing, so these tests
// pin the comment text alongside the behavior.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC_PATH = path.join(
  process.cwd(),
  "src/lib/creditMemo/inputs/upsertBorrowerStory.ts",
);
const SRC = fs.readFileSync(SRC_PATH, "utf-8");

test("[upsertBorrowerStory.trustedBankId-1] type accepts optional trustedBankId", () => {
  assert.match(SRC, /trustedBankId\?\s*:\s*string/);
});

test("[upsertBorrowerStory.trustedBankId-2] security comment marks parameter INTERNAL ONLY", () => {
  assert.ok(
    SRC.includes("INTERNAL ONLY"),
    "trustedBankId security comment must include the literal 'INTERNAL ONLY'",
  );
  assert.ok(
    SRC.includes("NEVER expose this parameter via an API route"),
    "comment must explicitly forbid API route exposure",
  );
  assert.ok(
    SRC.includes("tenant-isolation bypass"),
    "comment must explain the security consequence",
  );
});

test("[upsertBorrowerStory.trustedBankId-3] supplying trustedBankId skips ensureDealBankAccess", () => {
  // The bankId resolution must branch on args.trustedBankId BEFORE the
  // ensureDealBankAccess call.
  assert.match(SRC, /if\s*\(\s*args\.trustedBankId\s*\)/);
});

test("[upsertBorrowerStory.trustedBankId-4] non-trusted path still calls ensureDealBankAccess", () => {
  // Backwards compatibility: existing call sites that don't pass
  // trustedBankId must still go through the auth helper.
  assert.match(SRC, /ensureDealBankAccess\(args\.dealId\)/);
});

test("[upsertBorrowerStory.trustedBankId-5] non-trusted failure still returns tenant_mismatch", () => {
  // The else branch's failure mode must be unchanged so existing callers
  // see the same error shape.
  assert.match(
    SRC,
    /return\s*\{\s*ok:\s*false,\s*reason:\s*["']tenant_mismatch["']/,
  );
});
