/**
 * SPEC-FINENGINE-EXTRACTION-RECONCILIATION-1 Layer 2 — Fix 1.
 * The NET_INCOME instruction must direct the extractor to Form 1120 Line 28
 * (taxable income BEFORE NOL), not the post-NOL Line 30 which reads $0 after a
 * loss carryforward (OmniCare 2024 root cause).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const promptSrc = readFileSync(join(here, "..", "businessTaxReturn.ts"), "utf8");

describe("businessTaxReturn NET_INCOME line reference", () => {
  const netIncomeLine = promptSrc
    .split("\n")
    .find((l) => l.includes("NET_INCOME: Net income"));

  it("points NET_INCOME at Line 28 (before NOL)", () => {
    assert.ok(netIncomeLine, "NET_INCOME instruction present");
    assert.match(netIncomeLine!, /Line 28/, "must cite Line 28");
    assert.match(netIncomeLine!, /before/i, "must say before the NOL deduction");
  });

  it("no longer instructs the extractor to use the post-NOL Line 30 as the value", () => {
    // 'Line 30' may still be named as the thing to AVOID, but not as the source.
    assert.doesNotMatch(
      netIncomeLine!,
      /before NOL, Line 30/,
      "the old contradictory 'before NOL, Line 30' phrasing must be gone",
    );
  });
});
