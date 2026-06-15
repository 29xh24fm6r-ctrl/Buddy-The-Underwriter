import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { CLASSIC_PDF_RENDER_VERSION } from "../classicPdfRenderVersion";

/**
 * SPEC-SPREAD-SOURCE-OF-TRUTH-UNIFICATION-1 (surgical fix): the classic PDF must render
 * the canonical view model's period list (empty/quarantined columns dropped) and a cached
 * blob from an older render version must not be served.
 */
const read = (rel: string) => fs.readFileSync(rel, "utf8");

describe("classic loader drives periods from the VM", () => {
  const src = read("src/lib/classicSpread/classicSpreadLoader.ts");
  it("filters the rendered period list to canonByPeriod (VM-emitted columns)", () => {
    assert.match(src, /rawPeriods\.filter\(\(p\) => canonByPeriod\.has\(p\)\)/);
  });
  it("falls back to the full legacy list only when the VM is unavailable (empty)", () => {
    assert.match(src, /canonByPeriod\.size > 0 \? rawPeriods\.filter/);
  });
});

describe("CLASSIC_PDF cache is code-version invalidated", () => {
  it("a render version constant exists", () => {
    const v = read("src/lib/classicSpread/classicPdfRenderVersion.ts");
    assert.match(v, /CLASSIC_PDF_RENDER_VERSION\s*=\s*\d+/);
  });

  // SPEC-CLASSIC-SPREAD-CERTIFICATION-INTEGRATION-GATE-1 bumped this to 4 for the certification
  // gate. v5 is the render-consistency fix (liability-derived ratios blank when Total Liabilities
  // is unavailable; GCF band falls back to UNKNOWN when globalDscr is blank) — a code-only output
  // change with NO fact edit, so the version MUST advance to bust the existing v4 blob.
  it("render version is 5 (bumped for the render-consistency output change)", () => {
    assert.equal(CLASSIC_PDF_RENDER_VERSION, 5);
  });

  it("the version comparison rejects every pre-fix blob and accepts only a current-version blob", () => {
    // Mirrors the cached/ensure guard: (renderVersion ?? 0) !== CLASSIC_PDF_RENDER_VERSION
    const isRejected = (renderVersion: number | undefined) =>
      (renderVersion ?? 0) !== CLASSIC_PDF_RENDER_VERSION;
    assert.equal(isRejected(2), true); // pre-spine v2 blob rejected
    assert.equal(isRejected(3), true); // pre-gate v3 blob rejected
    assert.equal(isRejected(4), true); // pre-render-consistency-fix v4 blob rejected
    assert.equal(isRejected(undefined), true); // legacy unversioned blob rejected
    assert.equal(isRejected(CLASSIC_PDF_RENDER_VERSION), false); // fresh v5 blob is served
  });
  it("worker + sync route stamp renderVersion into the cached payload", () => {
    assert.match(read("src/lib/classicSpread/classicPdfWorker.ts"), /renderVersion: CLASSIC_PDF_RENDER_VERSION/);
    assert.match(read("src/app/api/deals/[dealId]/classic-spread/route.ts"), /renderVersion: CLASSIC_PDF_RENDER_VERSION/);
  });
  it("cached route 404s a blob whose renderVersion differs (cannot serve a pre-fix blob)", () => {
    const cached = read("src/app/api/deals/[dealId]/classic-spread/cached/route.ts");
    assert.match(cached, /payload\.renderVersion \?\? 0\) !== CLASSIC_PDF_RENDER_VERSION/);
    assert.match(cached, /status: 404/);
  });
  it("ensure route treats a version-mismatched blob as stale and re-enqueues (does not report cached)", () => {
    const ensure = read("src/app/api/deals/[dealId]/classic-spread/ensure/route.ts");
    // The freshness short-circuit must honor renderVersion, not just the fact timestamp.
    assert.match(ensure, /row\.rendered_json\?\.renderVersion \?\? 0\) !== CLASSIC_PDF_RENDER_VERSION/);
    assert.match(ensure, /isStale = true/);
    assert.match(ensure, /enqueueSpreadRecompute/);
  });
});
