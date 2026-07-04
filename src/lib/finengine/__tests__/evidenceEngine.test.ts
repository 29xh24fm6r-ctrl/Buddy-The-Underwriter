/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 14 tests.
 *
 * Confidence reflects support vs contradiction; missing evidence haircuts it;
 * source anchors survive; and evidence survives through a product-analysis-like
 * transform via WithEvidence<T>.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildEvidenceBundle,
  attachEvidence,
  summarizeEvidence,
  isSupported,
  type EvidenceItem,
  type WithEvidence,
} from "@/lib/finengine/evidence";

describe("PR14 — confidence from evidence balance", () => {
  it("well-supported conclusion has high confidence", () => {
    const items: EvidenceItem[] = [
      { kind: "supporting", statement: "DSCR 1.5x from certified spread", anchor: { sourceRef: "deal_spreads:1", page: 4 } },
      { kind: "supporting", statement: "Two years positive cash flow" },
    ];
    const b = buildEvidenceBundle("Repayment capacity is adequate", items);
    assert.ok(b.confidence > 0.9);
    assert.ok(isSupported(b));
  });

  it("contradicting evidence lowers confidence", () => {
    const b = buildEvidenceBundle("Repayment capacity is adequate", [
      { kind: "supporting", statement: "DSCR 1.5x" },
      { kind: "contradicting", statement: "Declining revenue trend" },
    ]);
    assert.ok(b.confidence > 0.4 && b.confidence < 0.7);
  });

  it("missing evidence applies a completeness haircut", () => {
    const withMissing = buildEvidenceBundle("X", [
      { kind: "supporting", statement: "s" },
      { kind: "missing", statement: "No interim financials" },
    ]);
    const without = buildEvidenceBundle("X", [{ kind: "supporting", statement: "s" }]);
    assert.ok(withMissing.confidence < without.confidence);
  });

  it("no supporting AND no contradicting → confidence 0 (unsupported)", () => {
    const b = buildEvidenceBundle("Unsupported claim", [{ kind: "missing", statement: "everything" }]);
    assert.equal(b.confidence, 0);
    assert.equal(isSupported(b), false);
  });
});

describe("PR14 — source anchors", () => {
  it("collects and de-duplicates anchors", () => {
    const b = buildEvidenceBundle("c", [
      { kind: "supporting", statement: "a", anchor: { sourceRef: "doc:1", page: 2 } },
      { kind: "supporting", statement: "b", anchor: { sourceRef: "doc:1", page: 2 } }, // dup
      { kind: "contradicting", statement: "d", anchor: { sourceRef: "doc:2", page: 5 } },
    ]);
    assert.equal(b.sourceAnchors.length, 2);
  });
});

describe("PR14 — evidence survives through product analysis", () => {
  it("WithEvidence<T> preserves the object AND its evidence across a transform", () => {
    type Analysis = { metric: string; value: number };
    const analysis: Analysis = { metric: "DSCR", value: 1.35 };
    const bundle = buildEvidenceBundle("DSCR is adequate", [{ kind: "supporting", statement: "certified" }]);
    const withEv: WithEvidence<Analysis> = attachEvidence(analysis, bundle);

    // Simulate a downstream product-analysis transform that maps the object.
    const downstream = (a: WithEvidence<Analysis>): WithEvidence<Analysis & { rated: string }> =>
      attachEvidence({ ...a, rated: a.value >= 1.25 ? "adequate" : "weak" }, a.evidence);

    const result = downstream(withEv);
    assert.equal(result.value, 1.35);
    assert.equal(result.rated, "adequate");
    // Evidence survived the transform intact.
    assert.equal(result.evidence.conclusion, "DSCR is adequate");
    assert.equal(result.evidence.supporting.length, 1);
  });

  it("summarizeEvidence reads cleanly", () => {
    const b = buildEvidenceBundle("Adequate", [
      { kind: "supporting", statement: "s" },
      { kind: "missing", statement: "m" },
    ]);
    assert.ok(summarizeEvidence(b).includes("1 supporting"));
    assert.ok(summarizeEvidence(b).includes("confidence"));
  });
});
