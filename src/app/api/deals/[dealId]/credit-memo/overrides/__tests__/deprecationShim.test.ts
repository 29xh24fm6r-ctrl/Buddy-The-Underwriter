// SPEC-13.5 PR-B B-4 (R2) — guard tests for the legacy
// /credit-memo/overrides POST deprecation shim.
//
// The POST has been a no-op shim since SPEC-13. Per refinement R2, this
// commit adds memo_input.deprecated_endpoint_hit telemetry so the
// 14-day observation window can detect stale clients (cached browser JS,
// mobile, integrations) that haven't picked up the wizard rewire.
//
// These guards also pin the no-write invariant: PR-C's CI guard catches
// new code that writes to deal_memo_overrides, but a regression in this
// specific handler would slip past that grep — so we pin it here too.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC_PATH = path.join(
  process.cwd(),
  "src/app/api/deals/[dealId]/credit-memo/overrides/route.ts",
);
const SRC = fs.readFileSync(SRC_PATH, "utf-8");

function postHandlerBody(): string {
  const fnIdx = SRC.indexOf("export async function POST");
  assert.ok(fnIdx > 0, "POST handler must exist");
  const getIdx = SRC.indexOf("export async function GET");
  return SRC.slice(fnIdx, getIdx > 0 ? getIdx : undefined);
}

test("[deprecationShim-1] POST handler imports writeEvent", () => {
  assert.match(
    SRC,
    /import\s*\{\s*writeEvent\s*\}\s*from\s*["']@\/lib\/ledger\/writeEvent["']/,
  );
});

test("[deprecationShim-2] POST handler emits memo_input.deprecated_endpoint_hit", () => {
  const body = postHandlerBody();
  assert.ok(
    body.includes("memo_input.deprecated_endpoint_hit"),
    "POST handler must emit memo_input.deprecated_endpoint_hit telemetry",
  );
});

test("[deprecationShim-3] event payload includes payload_keys, user_agent, referer", () => {
  const body = postHandlerBody();
  const kindIdx = body.indexOf('"memo_input.deprecated_endpoint_hit"');
  assert.ok(kindIdx > 0);
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
    "event must include payload_keys to fingerprint stale clients",
  );
  assert.ok(
    block.includes("user_agent"),
    "event must include user_agent to identify cached browser clients",
  );
  assert.ok(
    block.includes("referer"),
    "event must include referer to identify the source page",
  );
});

test("[deprecationShim-4] POST handler does NOT write to deal_memo_overrides", () => {
  // The POST handler must remain a no-op shim. GET still reads
  // (legitimate prefill source) — that's outside this guard's scope.
  const body = postHandlerBody();
  assert.ok(
    !/\.from\(["']deal_memo_overrides["']\)\s*\.\s*(insert|update|upsert|delete)\b/i
      .test(body),
    "POST handler must not write to deal_memo_overrides — must remain a no-op shim",
  );
});

test("[deprecationShim-5] response shape preserves deprecated:true + successor", () => {
  const body = postHandlerBody();
  // Per Risk #5: the response shape must remain stable across PR-B so
  // any in-flight clients (the wizard before B-2 rewires it) still parse
  // the response without erroring.
  assert.match(
    body,
    /ok:\s*true,[\s\S]{0,80}deprecated:\s*true/,
    "response must include ok: true and deprecated: true",
  );
  assert.match(body, /successor:/, "response must point clients to the successor URL");
});

test("[deprecationShim-6] telemetry fires BEFORE the response is returned", () => {
  // If the writeEvent call were placed after the return, it would never
  // execute. Pin the ordering: writeEvent comes before NextResponse.json.
  const body = postHandlerBody();
  const writeEventIdx = body.indexOf('"memo_input.deprecated_endpoint_hit"');
  // Find the deprecation response (the one with ok:true, deprecated:true).
  const responseIdx = body.search(
    /return\s+NextResponse\.json\(\{\s*[\s\S]*?ok:\s*true,[\s\S]*?deprecated:\s*true/,
  );
  assert.ok(writeEventIdx > 0 && responseIdx > 0);
  assert.ok(
    writeEventIdx < responseIdx,
    "writeEvent must fire before the deprecation response is returned",
  );
});

test("[deprecationShim-7] tenant access check still gates the telemetry write", () => {
  // ensureDealBankAccess must succeed before writeEvent fires — otherwise
  // a stranger could spam telemetry on any dealId.
  const body = postHandlerBody();
  const ensureIdx = body.indexOf("ensureDealBankAccess(");
  const writeEventIdx = body.indexOf('"memo_input.deprecated_endpoint_hit"');
  assert.ok(ensureIdx > 0);
  assert.ok(writeEventIdx > 0);
  assert.ok(
    ensureIdx < writeEventIdx,
    "ensureDealBankAccess must run before writeEvent — telemetry must not be writable without tenant access",
  );
});
