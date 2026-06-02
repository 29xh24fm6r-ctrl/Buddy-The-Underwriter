import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { borrowerIsRepresented } from "@/lib/borrower/borrowerRepresentation";

/**
 * SPEC-UNDERWRITE-GUARD-BORROWER-REPRESENTATION-PARITY-1
 *
 * /underwrite blocked dc52c626 with "Missing: borrower" via verifyUnderwriteCore's
 * legacy `!deal.borrower_id` check, even though the deal had a borrower story +
 * management profile (JourneyRail was already fixed in #469). Both layers must
 * now share one contract: borrower is represented if borrower_id OR borrower
 * story OR management profile exists.
 */

test("[a] borrower_id null + management profile exists → NOT missing borrower", () => {
  assert.equal(
    borrowerIsRepresented({
      borrowerId: null,
      managementProfileCount: 1,
      borrowerStoryCount: 0,
    }),
    true,
  );
});

test("[b] borrower_id null + borrower story exists → NOT missing borrower", () => {
  assert.equal(
    borrowerIsRepresented({
      borrowerId: null,
      managementProfileCount: 0,
      borrowerStoryCount: 1,
    }),
    true,
  );
});

test("[c] no borrower_id / story / management → missing borrower", () => {
  assert.equal(
    borrowerIsRepresented({
      borrowerId: null,
      managementProfileCount: 0,
      borrowerStoryCount: 0,
    }),
    false,
  );
});

test("borrower_id present always counts as represented", () => {
  assert.equal(
    borrowerIsRepresented({
      borrowerId: "b-123",
      managementProfileCount: 0,
      borrowerStoryCount: 0,
    }),
    true,
  );
});

test("both layers use the shared hasBorrowerRepresentation helper (no split)", () => {
  const root = process.cwd();
  const verify = fs.readFileSync(
    path.resolve(root, "src/lib/deals/verifyUnderwriteCore.ts"),
    "utf8",
  );
  const lifecycle = fs.readFileSync(
    path.resolve(root, "src/buddy/lifecycle/deriveLifecycleState.ts"),
    "utf8",
  );

  const nextStep = fs.readFileSync(
    path.resolve(root, "src/core/nextStep/computeNextStep.ts"),
    "utf8",
  );

  for (const [name, src] of [
    ["verifyUnderwriteCore", verify],
    ["deriveLifecycleState", lifecycle],
    ["computeNextStep", nextStep],
  ] as const) {
    assert.ok(
      /hasBorrowerRepresentation/.test(src),
      `${name} must use the shared hasBorrowerRepresentation helper`,
    );
  }

  // The underwrite guard must no longer push "borrower" from a bare borrower_id check.
  assert.ok(
    !/if\s*\(!deal\.borrower_id\)\s*\{\s*missing\.push\("borrower"\)/.test(
      verify.replace(/\s+/g, " "),
    ),
    "verifyUnderwriteCore must not gate borrower on bare deals.borrower_id",
  );
  // computeNextStep must no longer return missing:["borrower"] from a bare borrower_id check.
  assert.ok(
    !/if\s*\(!\(deal as any\)\?\.borrower_id\)\s*\{\s*return/.test(
      nextStep.replace(/\s+/g, " "),
    ),
    "computeNextStep must not gate borrower on bare deals.borrower_id",
  );
});
