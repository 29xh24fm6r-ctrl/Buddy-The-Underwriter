// SPEC-13.5 A-3 / A-6 — guard tests for the migration telemetry plumbing
// inside buildMemoInputPackage.
//
// Every migration call MUST emit an audit event. That telemetry is the
// structural fix that prevents another silent multi-month regression. These
// guards pin the event kind, the spec-required payload fields, and the
// zero-write WARN condition.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC_PATH = path.join(
  process.cwd(),
  "src/lib/creditMemo/inputs/buildMemoInputPackage.ts",
);
const SRC = fs.readFileSync(SRC_PATH, "utf-8");

test("[migrationTelemetry-1] imports writeEvent from canonical ledger module", () => {
  assert.match(
    SRC,
    /import\s*\{\s*writeEvent\s*\}\s*from\s*["']@\/lib\/ledger\/writeEvent["']/,
  );
});

test("[migrationTelemetry-2] emits the memo_input.legacy_migration audit event", () => {
  assert.ok(
    SRC.includes("memo_input.legacy_migration"),
    "buildMemoInputPackage must emit a memo_input.legacy_migration event",
  );
  assert.match(SRC, /writeEvent\(\{/, "writeEvent must be invoked");
});

test("[migrationTelemetry-3] event payload includes all spec-required fields", () => {
  // Find the writeEvent({ ... }) call by locating the kind and slicing forward
  // until balanced braces close. (A regex is fragile across multi-line nested
  // objects; a simple brace counter is reliable here.)
  const kindIdx = SRC.indexOf('"memo_input.legacy_migration"');
  assert.ok(kindIdx > 0, "event kind literal must be present");
  // Find the enclosing writeEvent({ ... }) — walk back to the writeEvent({.
  const callStart = SRC.lastIndexOf("writeEvent({", kindIdx);
  assert.ok(callStart > 0);
  // Walk forward to the matching closing brace.
  let depth = 0;
  let endIdx = callStart;
  for (let i = callStart; i < SRC.length; i++) {
    if (SRC[i] === "{") depth += 1;
    else if (SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  const block = SRC.slice(callStart, endIdx + 1);
  assert.ok(block.includes("bank_id"), "event must include bank_id");
  assert.ok(
    block.includes("borrower_story_written"),
    "event must include borrower_story_written",
  );
  assert.ok(
    block.includes("management_writes"),
    "event must include management_writes",
  );
  assert.ok(
    block.includes("skipped_reason"),
    "event must include skipped_reason",
  );
});

test("[migrationTelemetry-4] warns on zero-write case despite legacy overrides present", () => {
  // The console.warn is the human-readable backup signal alongside the audit
  // event. It must mention the canonical phrase the spec ties V-N checks to.
  assert.match(
    SRC,
    /console\.warn\([^)]*legacy migration produced zero writes/,
  );
});

test("[migrationTelemetry-5] warn condition excludes the borrower_story_exists idempotent path", () => {
  // The idempotent re-entry case (a deal already migrated) must not noise
  // the warn channel. The condition must explicitly exclude it.
  assert.ok(
    SRC.includes('!== "borrower_story_exists"') ||
      SRC.includes("!== 'borrower_story_exists'"),
    "warn block must exclude borrower_story_exists",
  );
});

test("[migrationTelemetry-6] event fires regardless of migration outcome (success OR thrown failure)", () => {
  // The writeEvent call must be OUTSIDE the try/catch so it fires even when
  // the wrapper throws. Pattern: try { migrationResult = await ...; } catch
  // { migrationError = ... } followed by await writeEvent({ ... }).
  const tryIdx = SRC.indexOf("migrationResult = await migrateLegacyOverridesToCanonical");
  assert.ok(tryIdx > 0, "migrationResult assignment must exist");
  const catchIdx = SRC.indexOf("} catch", tryIdx);
  const writeEventIdx = SRC.indexOf("writeEvent({", catchIdx);
  assert.ok(
    writeEventIdx > catchIdx,
    "writeEvent must be after the catch block, not inside the try",
  );
});

test("[migrationTelemetry-7] migrationError is captured and surfaced in event payload", () => {
  // When the wrapper throws (post-A-3), the error message is captured into
  // migrationError and emitted as `error` in the event payload.
  assert.match(SRC, /migrationError\s*=\s*err instanceof Error\s*\?\s*err\.message/);
  assert.match(SRC, /error:\s*migrationError/);
});
