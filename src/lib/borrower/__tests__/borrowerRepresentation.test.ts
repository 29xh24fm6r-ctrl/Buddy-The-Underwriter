import test from "node:test";
import assert from "node:assert/strict";

import { borrowerIsRepresented } from "@/lib/borrower/borrowerRepresentation";

/**
 * SPEC-UNDERWRITE-GUARD-BORROWER-REPRESENTATION-PARITY-1
 *
 * borrowerIsRepresented is the BROAD "is there any borrower representation at
 * all?" notion (borrower_id OR borrower story OR management profile). After
 * SPEC-BORROWER-ENTITY-SPONSOR-SEPARATION-1 it is no longer used to gate the
 * lifecycle/underwrite "borrower" check (that now uses the narrower legal
 * borrower identity — see borrowerIdentity.test.ts). It remains the contract
 * buildResearchSubject uses to decide whether a research subject is represented,
 * so these pure tests stay.
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
