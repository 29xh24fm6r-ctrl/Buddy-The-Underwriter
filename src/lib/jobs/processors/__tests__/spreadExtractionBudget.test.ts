import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXTRACTION_BUDGET_MS,
  nextExtractProgress,
  planExtraction,
  readExtractProgress,
  resolveExtractionBudgetMs,
  resolveExtractionDeadline,
  shouldDeferExtraction,
} from "../spreadExtractionBudget";

describe("resolveExtractionBudgetMs", () => {
  it("defaults to 150s", () => {
    assert.equal(resolveExtractionBudgetMs({}), DEFAULT_EXTRACTION_BUDGET_MS);
    assert.equal(DEFAULT_EXTRACTION_BUDGET_MS, 150_000);
  });

  it("honours a positive override and ignores junk", () => {
    assert.equal(resolveExtractionBudgetMs({ SPREAD_EXTRACTION_BUDGET_MS: "60000" }), 60_000);
    assert.equal(resolveExtractionBudgetMs({ SPREAD_EXTRACTION_BUDGET_MS: "0" }), 150_000);
    assert.equal(resolveExtractionBudgetMs({ SPREAD_EXTRACTION_BUDGET_MS: "soon" }), 150_000);
  });
});

describe("readExtractProgress", () => {
  it("returns null when meta carries no usable progress", () => {
    assert.equal(readExtractProgress(null), null);
    assert.equal(readExtractProgress({}), null);
    assert.equal(readExtractProgress({ extract_progress: { done: ["a"] } }), null);
  });

  it("parses cycle, done ids and resume count", () => {
    const p = readExtractProgress({
      extract_progress: { cycle: "2026-09-02T19:50:00.000Z", done: ["a", 3, "", "b"], resumes: 2 },
    });
    assert.deepEqual(p, { cycle: "2026-09-02T19:50:00.000Z", done: ["a", "b"], resumes: 2 });
  });
});

describe("planExtraction", () => {
  const docs = [
    { id: "tr-1", canonical_type: "BUSINESS_TAX_RETURN" },
    { id: "photo", canonical_type: "DRIVERS_LICENSE" },
    { id: "pfs", canonical_type: null, ai_doc_type: "pfs" },
    { id: "bs", canonical_type: null, ai_doc_type: null, document_type: "BALANCE_SHEET" },
  ];

  it("keeps only extractable doc types, in order", () => {
    const plan = planExtraction({ activeDocs: docs, meta: {} });
    assert.deepEqual(plan.extractable.map((d) => d.id), ["tr-1", "pfs", "bs"]);
    assert.deepEqual(plan.remaining.map((d) => d.id), ["tr-1", "pfs", "bs"]);
    assert.deepEqual(plan.done, []);
    assert.equal(plan.progress, null);
  });

  it("skips documents finished in an earlier lease of the same cycle", () => {
    const plan = planExtraction({
      activeDocs: docs,
      meta: { extract_progress: { cycle: "c1", done: ["tr-1", "pfs", "gone"], resumes: 1 } },
    });
    assert.deepEqual(plan.remaining.map((d) => d.id), ["bs"]);
    // Ids that are no longer active documents are dropped from the done list.
    assert.deepEqual(plan.done, ["tr-1", "pfs"]);
    assert.equal(plan.progress?.resumes, 1);
  });
});

describe("resolveExtractionDeadline / shouldDeferExtraction", () => {
  it("uses the budget when no invocation deadline is given", () => {
    assert.equal(resolveExtractionDeadline({ startedAt: 1_000, budgetMs: 500 }), 1_500);
    assert.equal(resolveExtractionDeadline({ startedAt: 1_000, budgetMs: 500, deadlineAt: null }), 1_500);
  });

  it("lets the invocation deadline tighten but never loosen the budget", () => {
    assert.equal(resolveExtractionDeadline({ startedAt: 1_000, budgetMs: 500, deadlineAt: 1_200 }), 1_200);
    assert.equal(resolveExtractionDeadline({ startedAt: 1_000, budgetMs: 500, deadlineAt: 9_000 }), 1_500);
  });

  it("always extracts the first document of a lease, then stops once past the deadline", () => {
    assert.equal(shouldDeferExtraction({ index: 0, now: 5_000, deadline: 1_000 }), false);
    assert.equal(shouldDeferExtraction({ index: 1, now: 999, deadline: 1_000 }), false);
    assert.equal(shouldDeferExtraction({ index: 1, now: 1_000, deadline: 1_000 }), true);
  });
});

describe("nextExtractProgress", () => {
  it("starts a cycle on the first deferral and increments resumes after", () => {
    const first = nextExtractProgress({ prior: null, cycleStartedAt: Date.UTC(2026, 8, 2, 19, 50), done: ["a", "a", "b"] });
    assert.equal(first.cycle, "2026-09-02T19:50:00.000Z");
    assert.deepEqual(first.done, ["a", "b"]);
    assert.equal(first.resumes, 1);

    const second = nextExtractProgress({ prior: first, cycleStartedAt: Date.now(), done: [...first.done, "c"] });
    assert.equal(second.cycle, first.cycle);
    assert.deepEqual(second.done, ["a", "b", "c"]);
    assert.equal(second.resumes, 2);
  });
});
