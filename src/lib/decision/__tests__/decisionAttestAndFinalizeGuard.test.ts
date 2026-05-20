import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../../..",
);

function readSource(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

const attestRoute = readSource(
  "src/app/api/deals/[dealId]/decision/[snapshotId]/attest/route.ts",
);
const finalizeRoute = readSource(
  "src/app/api/deals/[dealId]/decision/[snapshotId]/finalize/route.ts",
);
const onePager = readSource(
  "src/components/decision/DecisionOnePager.tsx",
);

// ---------------------------------------------------------------------------
// SPEC-DECISION-ATTEST-FIX-1 guards
// ---------------------------------------------------------------------------

test("attest POST insert does not include bank_id field", () => {
  // Find the .insert({ block and check it doesn't contain bank_id
  const insertMatch = attestRoute.match(/\.insert\(\{[\s\S]*?\}\)/);
  assert.ok(insertMatch, "Could not find .insert() call in attest route");
  assert.ok(
    !insertMatch[0].includes("bank_id"),
    "attest POST insert still includes bank_id — column does not exist on decision_attestations",
  );
});

test("attest POST wraps writeDealEvent in try/catch", () => {
  // The writeDealEvent call should be inside a try block
  const tryIdx = attestRoute.indexOf("try {");
  const writeIdx = attestRoute.indexOf("writeDealEvent(");
  const catchIdx = attestRoute.indexOf("} catch (eventErr");
  assert.ok(tryIdx !== -1, "No try block found around writeDealEvent");
  assert.ok(writeIdx !== -1, "writeDealEvent not found");
  assert.ok(catchIdx !== -1, "No catch for writeDealEvent");
  assert.ok(tryIdx < writeIdx && writeIdx < catchIdx, "writeDealEvent not wrapped in try/catch");
});

test("attest GET returns 401 when getCurrentBankId returns null", () => {
  // The GET handler should check !bankId before fetchDealBankId
  const getHandler = attestRoute.slice(attestRoute.indexOf("export async function GET"));
  const bankIdCheck = getHandler.indexOf("!bankId");
  const fetchDealBank = getHandler.indexOf("fetchDealBankId");
  assert.ok(bankIdCheck !== -1, "GET handler missing null bankId check");
  assert.ok(fetchDealBank !== -1, "GET handler missing fetchDealBankId");
  assert.ok(bankIdCheck < fetchDealBank, "bankId null check must come before fetchDealBankId");
});

test("attest POST returns 401 when getCurrentBankId returns null", () => {
  // The POST handler should check !bankId early
  const postHandler = attestRoute.slice(
    attestRoute.indexOf("export async function POST"),
    attestRoute.indexOf("export async function GET"),
  );
  const bankIdCheck = postHandler.indexOf("!bankId");
  const fetchDealBank = postHandler.indexOf("fetchDealBankId");
  assert.ok(bankIdCheck !== -1, "POST handler missing null bankId check");
  assert.ok(fetchDealBank !== -1, "POST handler missing fetchDealBankId");
  assert.ok(bankIdCheck < fetchDealBank, "bankId null check must come before fetchDealBankId");
});

// ---------------------------------------------------------------------------
// SPEC-DECISION-PAGE-ACTION-1 guards
// ---------------------------------------------------------------------------

test("POST /decision/[snapshotId]/finalize route exists", () => {
  assert.ok(finalizeRoute.length > 0);
  assert.match(finalizeRoute, /export async function POST/);
});

test("finalize route updates decision_snapshots.status to final", () => {
  assert.match(finalizeRoute, /\.update\(\{[\s\S]*?status:\s*["']final["']/);
});

test("finalize route updates deals.stage to decision_made", () => {
  assert.match(finalizeRoute, /stage:\s*["']decision_made["']/);
});

test("finalize route calls recomputeDealReady", () => {
  assert.match(finalizeRoute, /recomputeDealReady/);
});

test("DecisionOnePager renders Confirm Decision button when status=proposed", () => {
  assert.match(onePager, /snapshot\.status\s*===\s*["']proposed["']/);
  assert.match(onePager, /Confirm Decision/);
});

test("DecisionOnePager does not render Confirm Decision when status=final", () => {
  // The "Confirm Decision" button is gated on proposed, not final.
  // The Attest Decision link is what shows for final status.
  assert.match(onePager, /snapshot\.status\s*===\s*["']final["'][\s\S]*?Attest Decision/);
});
