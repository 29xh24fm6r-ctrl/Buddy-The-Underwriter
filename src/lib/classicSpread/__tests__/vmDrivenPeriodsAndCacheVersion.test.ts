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

  // SPEC-CLASSIC-SPREAD-CERTIFICATION-INTEGRATION-GATE-1: the certification gate changed the
  // rendered output (suppressed/replaced values), so the version must advance past every pre-gate
  // blob — otherwise a stale blob keeps being served by /classic-spread/cached.
  it("render version is 4 (bumped for the certification-gate output change)", () => {
    assert.equal(CLASSIC_PDF_RENDER_VERSION, 4);
  });

  it("the cached-route version comparison rejects any pre-gate blob and accepts a v4 blob", () => {
    // Mirrors the cached route guard: (payload.renderVersion ?? 0) !== CLASSIC_PDF_RENDER_VERSION
    const isRejected = (renderVersion: number | undefined) =>
      (renderVersion ?? 0) !== CLASSIC_PDF_RENDER_VERSION;
    assert.equal(isRejected(2), true); // pre-spine v2 blob rejected
    assert.equal(isRejected(3), true); // pre-gate v3 blob rejected
    assert.equal(isRejected(undefined), true); // legacy unversioned blob rejected
    assert.equal(isRejected(CLASSIC_PDF_RENDER_VERSION), false); // fresh v4 blob is served
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
