import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAllDocs,
  type ClassifyLoopDoc,
} from "../classifyAllDocs";
import type { GatekeeperResult } from "@/lib/gatekeeper/types";

// ─── Spec D5 — reclassify loop accumulation test ─────────────────────────────
//
// Mirrors the shape runGatekeeperForDocument returns. Lets us exercise the
// loop end-to-end without booting Gemini, Supabase, or the Next.js request
// cycle.

function makeDoc(overrides: Partial<ClassifyLoopDoc> = {}): ClassifyLoopDoc {
  return {
    id: "doc-1",
    deal_id: "deal-1",
    bank_id: "bank-1",
    sha256: "a".repeat(64),
    ocr_text: null,
    storage_bucket: "deal-documents",
    storage_path: "deal-1/doc-1.pdf",
    mime_type: "application/pdf",
    original_filename: "doc-1.pdf",
    ...overrides,
  };
}

function makeGatekeeperResult(
  overrides: Partial<GatekeeperResult> & {
    business_name?: string | null;
    borrower_name?: string | null;
  } = {},
): GatekeeperResult {
  const {
    business_name = null,
    borrower_name = null,
    ...rest
  } = overrides;
  return {
    doc_type: "BUSINESS_TAX_RETURN",
    confidence: 0.95,
    tax_year: 2024,
    reasons: ["Form 1065 visible"],
    detected_signals: {
      form_numbers: ["1065"],
      has_ein: true,
      has_ssn: false,
      business_name,
      borrower_name,
    },
    route: "STANDARD",
    needs_review: false,
    reviewReasonCode: null,
    cache_hit: false,
    model: "gemini-2.0-flash",
    prompt_version: "gemini_classifier_v2",
    prompt_hash: "abcdef0123456789",
    input_path: "text",
    ...rest,
  };
}

describe("classifyAllDocs — empty input", () => {
  it("returns zero-counts summary for an empty docs list", async () => {
    const summary = await classifyAllDocs([], async () => {
      throw new Error("classify should not be called for an empty list");
    });
    assert.deepEqual(summary, {
      total: 0,
      reclassified: 0,
      failed: 0,
      results: [],
      errors: [],
    });
  });
});

describe("classifyAllDocs — all successful", () => {
  it("calls classify once per doc and accumulates into results", async () => {
    const docs = [
      makeDoc({ id: "d1", original_filename: "a.pdf" }),
      makeDoc({ id: "d2", original_filename: "b.pdf" }),
      makeDoc({ id: "d3", original_filename: "c.pdf" }),
    ];
    let callCount = 0;
    const calledFor: string[] = [];
    const summary = await classifyAllDocs(docs, async (doc) => {
      callCount++;
      calledFor.push(doc.id);
      return makeGatekeeperResult({
        business_name: `Business for ${doc.id}`,
        borrower_name: null,
      });
    });

    assert.equal(callCount, 3);
    assert.deepEqual(calledFor, ["d1", "d2", "d3"]);
    assert.equal(summary.total, 3);
    assert.equal(summary.reclassified, 3);
    assert.equal(summary.failed, 0);
    assert.equal(summary.errors.length, 0);
    assert.equal(summary.results.length, 3);
    assert.equal(summary.results[0].filename, "a.pdf");
    assert.equal(summary.results[0].business_name, "Business for d1");
    assert.equal(summary.results[0].borrower_name, null);
    assert.equal(summary.results[0].doc_type, "BUSINESS_TAX_RETURN");
    assert.equal(summary.results[0].confidence, 0.95);
  });

  it("propagates cache_hit and entity names from the gatekeeper result", async () => {
    const docs = [makeDoc()];
    const summary = await classifyAllDocs(docs, async () =>
      makeGatekeeperResult({
        cache_hit: true,
        business_name: "Samaritus Management LLC",
        borrower_name: "Michael Newmark",
      }),
    );
    assert.equal(summary.results[0].cache_hit, true);
    assert.equal(summary.results[0].business_name, "Samaritus Management LLC");
    assert.equal(summary.results[0].borrower_name, "Michael Newmark");
  });
});

describe("classifyAllDocs — error accumulation", () => {
  it("collects thrown errors into errors[] and does NOT abort the loop", async () => {
    const docs = [
      makeDoc({ id: "d1", original_filename: "a.pdf" }),
      makeDoc({ id: "d2", original_filename: "b.pdf" }),
      makeDoc({ id: "d3", original_filename: "c.pdf" }),
    ];
    const summary = await classifyAllDocs(docs, async (doc) => {
      if (doc.id === "d2") throw new Error("vision download failed");
      return makeGatekeeperResult();
    });

    assert.equal(summary.total, 3);
    assert.equal(summary.reclassified, 2);
    assert.equal(summary.failed, 1);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].documentId, "d2");
    assert.equal(summary.errors[0].filename, "b.pdf");
    assert.equal(summary.errors[0].error, "vision download failed");
    // The docs after the failing one still get classified — partial success is
    // a legitimate outcome, not a stop signal.
    assert.equal(summary.results.length, 2);
    assert.deepEqual(
      summary.results.map((r) => r.documentId),
      ["d1", "d3"],
    );
  });

  it("coerces non-Error throws to 'unknown'", async () => {
    const docs = [makeDoc({ id: "d1" })];
    // Intentionally throw a non-Error value to exercise the fallback branch.
    const summary = await classifyAllDocs(docs, async () => {
      throw "a raw string error"; // eslint-disable-line @typescript-eslint/only-throw-error
    });
    assert.equal(summary.failed, 1);
    assert.equal(summary.errors[0].error, "unknown");
  });

  it("total === docs.length regardless of how many succeed", async () => {
    const docs = Array.from({ length: 9 }, (_, i) => makeDoc({ id: `d${i}` }));
    const summary = await classifyAllDocs(docs, async (doc) => {
      // 3/9 docs fail, mimicking flaky Gemini responses
      if (["d2", "d5", "d7"].includes(doc.id)) {
        throw new Error(`doc ${doc.id} failed`);
      }
      return makeGatekeeperResult();
    });
    assert.equal(summary.total, 9);
    assert.equal(summary.reclassified, 6);
    assert.equal(summary.failed, 3);
    assert.equal(summary.results.length + summary.errors.length, 9);
  });
});

describe("classifyAllDocs — doc identity preservation", () => {
  it("preserves documentId and original_filename in both results and errors", async () => {
    const docs = [
      makeDoc({ id: "d-ok", original_filename: "ok.pdf" }),
      makeDoc({ id: "d-fail", original_filename: "fail.pdf" }),
    ];
    const summary = await classifyAllDocs(docs, async (doc) => {
      if (doc.id === "d-fail") throw new Error("boom");
      return makeGatekeeperResult();
    });
    assert.equal(summary.results[0].documentId, "d-ok");
    assert.equal(summary.results[0].filename, "ok.pdf");
    assert.equal(summary.errors[0].documentId, "d-fail");
    assert.equal(summary.errors[0].filename, "fail.pdf");
  });

  it("handles null filenames without throwing", async () => {
    const docs = [makeDoc({ id: "d1", original_filename: null })];
    const summary = await classifyAllDocs(docs, async () => makeGatekeeperResult());
    assert.equal(summary.results[0].filename, null);
  });
});

describe("classifyAllDocs — Spec D5 serial invariant", () => {
  it("invokes classify serially, not in parallel", async () => {
    // The route.ts declares maxDuration=300 assuming a serial loop. If the
    // implementation ever switched to Promise.all the timing math would change.
    // This test pins the serial contract.
    const docs = [
      makeDoc({ id: "d1" }),
      makeDoc({ id: "d2" }),
      makeDoc({ id: "d3" }),
    ];
    let concurrent = 0;
    let maxConcurrent = 0;
    await classifyAllDocs(docs, async () => {
      concurrent++;
      if (concurrent > maxConcurrent) maxConcurrent = concurrent;
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return makeGatekeeperResult();
    });
    assert.equal(
      maxConcurrent,
      1,
      `expected serial execution (maxConcurrent=1), got ${maxConcurrent}`,
    );
  });
});
