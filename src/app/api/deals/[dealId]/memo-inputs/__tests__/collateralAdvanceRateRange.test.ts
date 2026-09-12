// Guard — /memo-inputs must reject an out-of-range collateral advance rate.
//
// advance_rate is a fraction of value in [0, 1]; 0.70 means 70%. This route
// coerced any finite number straight into the patch, so two production rows
// came to hold 80. computeCollateralFactValues multiplied by it, and a
// $1.2M property reached its credit memo carrying $96,000,000 of lendable
// value with LTV reading a hundredth of the truth.
//
// The database now refuses such a row outright. This route rejecting it first
// is what turns that into an answerable 400 rather than a raw 23514 surfacing
// as a 500 — and it covers every client of the route, not just the one form.
//
// Source-text guard, matching the neighbouring tests in this directory: the
// route module pulls in supabaseAdmin and the auth stack, so its handlers are
// not importable in a unit test. The behaviour itself is covered against the
// real resolver in src/lib/collateral/__tests__/collateralTypes.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/deals/[dealId]/memo-inputs/route.ts"),
  "utf-8",
);

function collateralPatchBody(): string {
  const start = SRC.indexOf("function buildCollateralPatch");
  assert.ok(start > 0, "buildCollateralPatch must exist");
  const open = SRC.indexOf("{", SRC.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < SRC.length; i++) {
    if (SRC[i] === "{") depth += 1;
    else if (SRC[i] === "}") {
      depth -= 1;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error("buildCollateralPatch body did not close");
}

test("[advance-rate-1] the patch builder validates advance_rate against the shared contract", () => {
  const body = collateralPatchBody();
  assert.match(
    body,
    /isValidAdvanceRate\s*\(\s*patch\.advance_rate\s*\)/,
    "advance_rate must be range-checked, and against collateralTypes' own " +
      "validator rather than a second copy of the bound",
  );
  assert.match(
    body,
    /throw new InvalidMemoInputError/,
    "an out-of-range rate must fail the request, never be silently dropped or stored",
  );
});

test("[advance-rate-2] the validator is imported from the collateral contract", () => {
  assert.match(
    SRC,
    /import\s*\{\s*isValidAdvanceRate\s*\}\s*from\s*"@\/lib\/collateral\/collateralTypes"/,
    "one definition of the valid range, shared with the memo and the builder",
  );
});

test("[advance-rate-3] POST and PATCH answer a bad value with 400, not 500", () => {
  const handlers = ["POST", "PATCH"];
  for (const verb of handlers) {
    const start = SRC.indexOf(`export async function ${verb}(`);
    assert.ok(start > 0, `${verb} handler must exist`);
    const end = SRC.indexOf("\nexport async function ", start + 1);
    const body = SRC.slice(start, end === -1 ? SRC.length : end);
    assert.match(
      body,
      /e instanceof InvalidMemoInputError[\s\S]*?status:\s*400/,
      `${verb} must answer an invalid input with 400 — a caller's bad value is ` +
        `theirs to fix, and a 500 tells them nothing`,
    );
  }
});
