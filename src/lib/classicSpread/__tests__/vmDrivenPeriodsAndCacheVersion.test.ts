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

  // SPEC-CLASSIC-SPREAD-FINANCIAL-PERIOD-SPINE-1: the period-spine fix changed classic output
  // (AR_AGING / personal-tax periods dropped), so the version must advance past the v2 blobs
  // rendered before it — otherwise a stale v2 blob (e.g. OmniCare's, still showing a 4/28/2026
  // AR-aging column) keeps being served by /classic-spread/cached.
  it("render version is 3 (bumped for the period-spine output change)", () => {
    assert.equal(CLASSIC_PDF_RENDER_VERSION, 3);
  });

  it("the cached-route version comparison rejects a pre-spine v2 blob and accepts a v3 blob", () => {
    // Mirrors the cached route guard: (payload.renderVersion ?? 0) !== CLASSIC_PDF_RENDER_VERSION
    const isRejected = (renderVersion: number | undefined) =>
      (renderVersion ?? 0) !== CLASSIC_PDF_RENDER_VERSION;
    assert.equal(isRejected(2), true); // existing OmniCare v2 blob is rejected
    assert.equal(isRejected(undefined), true); // legacy unversioned blob is rejected
    assert.equal(isRejected(CLASSIC_PDF_RENDER_VERSION), false); // fresh v3 blob is served
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
});
