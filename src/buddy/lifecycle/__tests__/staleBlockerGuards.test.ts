/**
 * SPEC-LIFECYCLE-CHECKLIST-READINESS-CANONICAL-FLOW-1 — Required test #5.
 *
 * The lifecycle must suppress a cached `unfinalized_required_documents` blocker
 * when the live checklist shows zero required rows still unsatisfied, but MUST
 * still surface it when a required row is genuinely unsatisfied.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  hasUnsatisfiedRequiredChecklist,
  suppressStaleUnfinalizedDocsBlocker,
} from "../staleBlockerGuards";

const UNFINALIZED = { code: "unfinalized_required_documents", message: "stale" };
const OTHER = { code: "missing_management_profile", message: "real" };

describe("hasUnsatisfiedRequiredChecklist", () => {
  test("false when every required row is received/waived/satisfied", () => {
    assert.equal(
      hasUnsatisfiedRequiredChecklist([
        { required: true, status: "received" },
        { required: true, status: "waived" },
        { required: false, status: "missing" }, // optional missing doesn't count
      ]),
      false,
    );
  });

  test("true when a required row is still missing", () => {
    assert.equal(
      hasUnsatisfiedRequiredChecklist([
        { required: true, status: "received" },
        { required: true, status: "missing" },
      ]),
      true,
    );
  });
});

describe("suppressStaleUnfinalizedDocsBlocker — #5", () => {
  test("live unsatisfied count zero → stale blocker is dropped", () => {
    const out = suppressStaleUnfinalizedDocsBlocker(
      [OTHER, UNFINALIZED],
      [{ required: true, status: "received" }],
    );
    assert.deepEqual(out.map((b) => b.code), ["missing_management_profile"]);
  });

  test("live unsatisfied count > 0 → blocker is preserved", () => {
    const out = suppressStaleUnfinalizedDocsBlocker(
      [OTHER, UNFINALIZED],
      [{ required: true, status: "missing" }],
    );
    assert.deepEqual(
      out.map((b) => b.code).sort(),
      ["missing_management_profile", "unfinalized_required_documents"],
    );
  });

  test("only the document blocker is ever touched; others pass through unchanged", () => {
    const out = suppressStaleUnfinalizedDocsBlocker([OTHER], []);
    assert.deepEqual(out, [OTHER]);
  });
});
