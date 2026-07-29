/**
 * SPEC-M2 BEAT-METRICS-1 — structural tripwires confirming the three
 * "wired today" emitters are actually called from their real call sites.
 * Source-grep style, same convention as openaiResilience.test.ts's
 * "Structural Tripwires" section — these call sites (session RPC flow,
 * a followup generator with a live route, an authenticated route handler)
 * aren't already covered by an existing mockable test harness in this
 * repo, so a full behavioral test would mean building that harness from
 * scratch; the source-shape check is the pragmatic equivalent used
 * elsewhere in this codebase for exactly this situation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("TRIPWIRE: session.ts calls emitFirstInteraction and emitFormlessStart after minting a new session", () => {
  const src = readFile("src/lib/brokerage/session.ts");
  assert.match(src, /import\s*\{[^}]*emitFirstInteraction[^}]*\}\s*from\s*["']\.\/beatMetrics["']/);
  assert.match(src, /await emitFirstInteraction\(dealId, sb\)/);
  assert.match(src, /await emitFormlessStart\(dealId, false, sb\)/);
});

test("TRIPWIRE: session.ts wraps the metrics emit in try/catch (must not block session creation)", () => {
  const src = readFile("src/lib/brokerage/session.ts");
  const emitIdx = src.indexOf("emitFirstInteraction(dealId, sb)");
  const tryIdx = src.lastIndexOf("try {", emitIdx);
  const catchIdx = src.indexOf("} catch", emitIdx);
  assert.ok(tryIdx > -1 && tryIdx < emitIdx, "emitFirstInteraction must be inside a try block");
  assert.ok(catchIdx > emitIdx, "must be followed by a catch block");
});

test("TRIPWIRE: generateMissingItemsFollowup calls emitDocRequestRound only when drafts were created", () => {
  const src = readFile("src/lib/agentWorkflows/followup/generateMissingItemsFollowup.ts");
  assert.match(
    src,
    /import\s*\{\s*emitDocRequestRound\s*\}\s*from\s*["']@\/lib\/brokerage\/beatMetrics["']/,
  );
  assert.match(src, /if\s*\(draftsCreated > 0\)\s*\{[\s\S]*?emitDocRequestRound\(dealId, draftsCreated, sb\)/);
});

test("TRIPWIRE: activity route POST handler wires both writeDealEvent and emitLenderFollowup", () => {
  const src = readFile("src/app/api/deals/[dealId]/activity/route.ts");
  assert.match(src, /export async function POST/);
  assert.match(src, /import\s*\{\s*writeDealEvent\s*\}\s*from\s*["']@\/lib\/events\/dealEvents["']/);
  assert.match(
    src,
    /import\s*\{\s*emitLenderFollowup\s*\}\s*from\s*["']@\/lib\/brokerage\/beatMetrics["']/,
  );
  assert.match(src, /kind:\s*["']lender\.followup\.logged["']/);
  assert.match(src, /await emitLenderFollowup\(dealId, body\.note, sb\)/);
});

test("TRIPWIRE: activity route POST enforces the same deal-bank-access check as GET", () => {
  const src = readFile("src/app/api/deals/[dealId]/activity/route.ts");
  const postIdx = src.indexOf("export async function POST");
  assert.ok(postIdx > -1);
  const postBody = src.slice(postIdx);
  assert.match(postBody, /ensureDealBankAccess\(dealId\)/);
  assert.match(postBody, /requireUser\(\)/);
});
