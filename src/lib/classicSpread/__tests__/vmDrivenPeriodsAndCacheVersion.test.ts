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

  // v4 cert gate; …; v11 resolver-aware audit de-dup; v12 blocker batch resolution; v13 final action
  // de-dup (TNCA folds into the implied-AR blocker). Each is an output change with no fact edit, so
  // the version MUST advance.
  it("render version is 15 (bumped for the per-domain certification lines on the audit page)", () => {
    assert.equal(CLASSIC_PDF_RENDER_VERSION, 15);
  });

  it("the version comparison rejects every pre-fix blob and accepts only a current-version blob", () => {
    // Mirrors the cached/ensure guard: (renderVersion ?? 0) !== CLASSIC_PDF_RENDER_VERSION
    const isRejected = (renderVersion: number | undefined) =>
      (renderVersion ?? 0) !== CLASSIC_PDF_RENDER_VERSION;
    assert.equal(isRejected(2), true); // pre-spine v2 blob rejected
    assert.equal(isRejected(3), true); // pre-gate v3 blob rejected
    assert.equal(isRejected(4), true); // pre-render-consistency-fix v4 blob rejected
    assert.equal(isRejected(5), true); // pre-audit-page v5 blob rejected
    assert.equal(isRejected(6), true); // pre-hardening v6 blob rejected
    assert.equal(isRejected(7), true); // pre-v7-followup v7 blob rejected
    assert.equal(isRejected(8), true); // pre-resolver v8 blob rejected
    assert.equal(isRejected(9), true); // pre-render-wiring v9 blob rejected
    assert.equal(isRejected(10), true); // pre-dedup v10 blob rejected
    assert.equal(isRejected(11), true); // pre-batch v11 blob rejected
    assert.equal(isRejected(12), true); // pre-final-dedup v12 blob rejected
    assert.equal(isRejected(13), true); // pre-certification-status v13 blob rejected
    assert.equal(isRejected(14), true); // pre-per-domain-lines v14 blob rejected
    assert.equal(isRejected(undefined), true); // legacy unversioned blob rejected
    assert.equal(isRejected(CLASSIC_PDF_RENDER_VERSION), false); // fresh v15 blob is served
  });
  // BUGFIX-CLASSIC-SPREAD-PDF-DOMAIN-CERTIFICATION-LINES-1: the audit page must render the FULL
  // certification status block (header + every line incl. the per-domain Personal income / GCF
  // lines), not just the header — a future refactor must not silently drop lines.slice(1).
  it("the audit page renders the per-domain certification status lines (not just counts)", () => {
    const src = read("src/lib/classicSpread/classicSpreadRenderer.ts");
    assert.match(src, /const lines = certificationStatusLines\(summary\)/);
    assert.match(src, /for \(const line of lines\.slice\(1\)\)/);
    assert.match(src, /drawCertificationStatus\(s, certSummary\)/);
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
