// SPEC-13.5 A-2 + A-3 — guard tests for the migration wrapper.
//
// The wrapper has two contract changes that must hold structurally:
//   1. (A-2) Both upsert calls receive `trustedBankId: args.bankId`. This
//      is what fixes the silent failure — the writer trusts the caller's
//      pre-resolved bank scope and skips its redundant access check.
//   2. (A-3) Writer failures THROW instead of silently recording `false`.
//      buildMemoInputPackage's audit event captures the throw as `error`.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC_PATH = path.join(
  process.cwd(),
  "src/lib/creditMemo/inputs/migrateLegacyOverridesAsync.ts",
);
const SRC = fs.readFileSync(SRC_PATH, "utf-8");

test("[migrateLegacy.trustedBankId-1] passes trustedBankId on upsertBorrowerStory call", () => {
  const idx = SRC.indexOf("upsertBorrowerStory({");
  assert.ok(idx > 0, "upsertBorrowerStory must be called");
  const block = SRC.slice(idx, idx + 600);
  assert.match(block, /trustedBankId:\s*args\.bankId/);
});

test("[migrateLegacy.trustedBankId-2] passes trustedBankId on upsertManagementProfile call", () => {
  const idx = SRC.indexOf("upsertManagementProfile({");
  assert.ok(idx > 0, "upsertManagementProfile must be called");
  const block = SRC.slice(idx, idx + 600);
  assert.match(block, /trustedBankId:\s*args\.bankId/);
});

test("[migrateLegacy.trustedBankId-3] code comment marks args.bankId as trusted-from-caller (addendum #10)", () => {
  // SPEC-13.5 addendum #10 — bank_id source must be explicit so future devs
  // don't introduce a re-resolution. Allow whitespace/comment markers
  // between phrases since the comment naturally wraps across lines.
  assert.match(
    SRC,
    /trusted from caller/i,
    "wrapper comment must contain the phrase 'trusted from caller'",
  );
  assert.match(
    SRC,
    /do NOT[\s\S]{0,40}re-resolve/i,
    "wrapper comment must contain the phrase 'do NOT ... re-resolve' (multi-line tolerant)",
  );
  assert.match(
    SRC,
    /addendum #10/i,
    "comment must reference SPEC-13.5 addendum #10 by name so it survives refactoring",
  );
});

test("[migrateLegacy.throwOnFail-1] borrower_story writer failure throws", () => {
  assert.match(
    SRC,
    /throw new Error\(\s*[`"']migrateLegacyOverrides:\s*borrower_story upsert failed/,
  );
});

test("[migrateLegacy.throwOnFail-2] management_profile writer failure throws", () => {
  assert.match(
    SRC,
    /throw new Error\(\s*[`"']migrateLegacyOverrides:\s*management_profile upsert failed/,
  );
});

test("[migrateLegacy.throwOnFail-3] borrowerStoryWritten is set unconditionally to true after successful upsert", () => {
  // Pre-A-3: `borrowerStoryWritten = out.ok` (silent false on failure).
  // Post-A-3: throw on failure, then `borrowerStoryWritten = true`.
  assert.match(SRC, /borrowerStoryWritten\s*=\s*true/);
  assert.ok(
    !SRC.includes("borrowerStoryWritten = out.ok"),
    "wrapper must NOT silently record `out.ok` — that's the bug A-3 fixes",
  );
});

test("[migrateLegacy.throwOnFail-4] managementWrites no longer gated on if(out.ok)", () => {
  // Pre-A-3: `if (out.ok) managementWrites += 1` (silent on failure).
  // Post-A-3: throw on failure, then unconditional `managementWrites += 1`.
  assert.ok(
    !/if\s*\(\s*out\.ok\s*\)\s*managementWrites/.test(SRC),
    "wrapper must NOT silently skip managementWrites on writer failure — A-3 throws instead",
  );
});
