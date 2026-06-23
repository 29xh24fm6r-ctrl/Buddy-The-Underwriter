import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MetricKpiCard } from "../CanonicalMemoTemplate";

/**
 * SPEC-DSCR-PRELIMINARY-LABEL-RENDERING-1 — the memo must render a "Preliminary"
 * badge + caveat for DSCR / GCF DSCR when the denominator is not yet committee-final
 * (global obligations unconfirmed or existing-debt schedule absent). Label/caveat
 * rendering only — no math, no facts.
 */

const render = (props: Parameters<typeof MetricKpiCard>[0]) =>
  renderToStaticMarkup(React.createElement(MetricKpiCard, props));

describe("MetricKpiCard preliminary label", () => {
  it("renders the Preliminary badge + caveat when preliminary", () => {
    const html = render({
      label: "DSCR (UW)",
      val: "7.12x",
      src: "Snapshot:DSCR",
      preliminary: true,
      caveat: "PRELIMINARY — guarantor/personal obligations are not yet confirmed.",
    });
    assert.match(html, /Preliminary/);
    assert.match(html, /guarantor\/personal obligations are not yet confirmed/);
    assert.match(html, /7\.12x/);
  });

  it("does NOT render the badge/caveat when not preliminary", () => {
    const html = render({
      label: "DSCR (UW)",
      val: "1.45x",
      src: "Snapshot:DSCR",
      preliminary: false,
      caveat: null,
    });
    assert.doesNotMatch(html, /Preliminary/);
    assert.match(html, /1\.45x/);
  });

  it("suppresses the caveat text when preliminary but no caveat provided (badge only)", () => {
    const html = render({ label: "DSCR (UW)", val: "2.0x", preliminary: true, caveat: null });
    assert.match(html, /Preliminary/);
    // no empty caveat line
    assert.doesNotMatch(html, /text-amber-700 mt-0\.5/);
  });

  it("the canonical template wires the DSCR (UW) card to the metric's preliminary/caveat", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const src = fs.readFileSync("src/components/creditMemo/CanonicalMemoTemplate.tsx", "utf8");
    assert.match(src, /preliminary:\s*km\.dscr_uw\.preliminary\s*===\s*true/);
    assert.match(src, /caveat:\s*km\.dscr_uw\.caveat/);
    assert.match(src, /<MetricKpiCard/);
  });
});
