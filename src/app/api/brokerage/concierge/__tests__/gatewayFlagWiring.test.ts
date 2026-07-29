import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SPEC-M5 CONVERSATIONAL-INTAKE-1 — structural tripwires for the concierge
 * route's gateway-migration wiring. Source-grep style, same convention as
 * beatMetricsWiring.test.ts's "Structural Tripwires" section: this route
 * handles cookies/rate-limiting/DB state that isn't already covered by a
 * mockable test harness in this repo, so a full behavioral test would mean
 * building that harness from scratch; the source-shape check is the
 * pragmatic equivalent used elsewhere for exactly this situation.
 *
 * What these tests protect: the gateway migration must stay OFF by default
 * (env-var gated, not hardcoded true) and must fail back to the pre-M5
 * direct callGeminiJSON path — flipping this on by accident, or losing the
 * fallback, would make the AI gateway's NPI gate refuse every borrower turn
 * in production the moment every provider is still PENDING in
 * VENDOR_NPI_APPROVAL.
 */
function readSrc(): string {
  return readFileSync(resolve(process.cwd(), "src/app/api/brokerage/concierge/route.ts"), "utf8");
}

test("TRIPWIRE: AI_GATEWAY_CONCIERGE_ENABLED is read from an env var, not hardcoded true", () => {
  const src = readSrc();
  assert.match(
    src,
    /const AI_GATEWAY_CONCIERGE_ENABLED = process\.env\.AI_GATEWAY_CONCIERGE_ENABLED === ["']true["'];/,
  );
});

test("TRIPWIRE: the gateway path is npiTagged and gated behind the flag", () => {
  const src = readSrc();
  const fnIdx = src.indexOf("async function callConciergeTurnModel");
  assert.ok(fnIdx > -1, "callConciergeTurnModel must exist");
  const fnBody = src.slice(fnIdx);
  const ifIdx = fnBody.indexOf("if (AI_GATEWAY_CONCIERGE_ENABLED)");
  assert.ok(ifIdx > -1, "gateway branch must be gated on the flag");
  const runRoleIdx = fnBody.indexOf('runRole("interviewer"');
  assert.ok(runRoleIdx > ifIdx, "runRole call must be inside the flag-gated branch");
  const gatewayBranch = fnBody.slice(ifIdx, runRoleIdx + 200);
  assert.match(gatewayBranch, /npiTagged:\s*true/);
});

test("TRIPWIRE: callConciergeTurnModel falls back to callGeminiJSON when the flag is off", () => {
  const src = readSrc();
  const fnIdx = src.indexOf("async function callConciergeTurnModel");
  const fnBody = src.slice(fnIdx, fnIdx + 3000);
  assert.match(fnBody, /callGeminiJSON</);
});

test("TRIPWIRE: the main turn call site uses callConciergeTurnModel, not a direct callGeminiJSON call", () => {
  const src = readSrc();
  const mainTurnIdx = src.indexOf("Combined turn: extraction + warm reply");
  assert.ok(mainTurnIdx > -1);
  const mainTurnRegion = src.slice(mainTurnIdx, mainTurnIdx + 2200);
  assert.match(mainTurnRegion, /await callConciergeTurnModel\(prompt, session\.deal_id\)/);
  assert.doesNotMatch(mainTurnRegion, /await callGeminiJSON</);
});

test("TRIPWIRE: recordFactRequest is only called when the asked field changed since last_asked_fact_key", () => {
  const src = readSrc();
  assert.match(
    src,
    /nextCriticalBeforeTurn\.factPath !== conciergeRow\.last_asked_fact_key/,
  );
  assert.match(src, /recordFactRequest\(session\.deal_id, nextCriticalBeforeTurn\.factPath, "concierge", sb\)/);
});

test("TRIPWIRE: last_asked_fact_key is persisted on every turn's session update", () => {
  const src = readSrc();
  assert.match(src, /last_asked_fact_key:\s*nextCriticalBeforeTurn\?\.factPath\s*\?\?\s*null/);
});

test("TRIPWIRE: nextRequiredFields call sites pass the canonically-answered set", () => {
  const src = readSrc();
  const matches = src.match(/computeNextRequiredFields\([^)]*canonicallyAnswered\)/g) ?? [];
  assert.equal(matches.length, 4, "all 4 response-building call sites must thread canonicallyAnswered through");
});
