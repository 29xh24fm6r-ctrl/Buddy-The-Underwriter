/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 27 tests.
 *
 * "Docs match code": every test file the arc test matrix lists must exist on
 * disk, and the operator docs must be present. No unsupported claims.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { FINENGINE_ARC, validateTestMatrix } from "@/lib/finengine/docs/testMatrix";

// The test:unit runner executes from the repo root; paths in the matrix are
// repo-relative.
const REPO_ROOT = process.cwd();
const exists = (p: string) => existsSync(join(REPO_ROOT, p));

describe("PR27 — test matrix matches code", () => {
  it("covers PRs 1–26 with distinct test files", () => {
    assert.equal(FINENGINE_ARC.length, 26);
    const files = new Set(FINENGINE_ARC.map((e) => e.testFile));
    assert.equal(files.size, 26);
  });

  it("every listed test file exists on disk", () => {
    const v = validateTestMatrix(exists);
    assert.deepEqual(v.missing, []);
    assert.equal(v.ok, true);
  });

  it("the validator catches a missing file", () => {
    const v = validateTestMatrix((p) => p !== FINENGINE_ARC[0].testFile);
    assert.equal(v.ok, false);
    assert.ok(v.missing.includes(FINENGINE_ARC[0].testFile));
  });
});

describe("PR27 — operator docs present", () => {
  const docs = [
    "docs/finengine/architecture.md",
    "docs/finengine/cutover-playbook.md",
    "docs/finengine/rollback-playbook.md",
    "docs/finengine/examiner-defensibility.md",
    "docs/finengine/evidence-provenance-model.md",
    "docs/finengine/test-matrix.md",
    "docs/finengine/legacy-burndown-ledger.md",
  ];
  for (const d of docs) {
    it(`${d} exists`, () => {
      assert.ok(exists(d), `${d} missing`);
    });
  }
});
