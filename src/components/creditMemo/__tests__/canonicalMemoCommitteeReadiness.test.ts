import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommitteeReadinessSection } from "../CanonicalMemoTemplate";
import type { MemoCommitteeReadinessSection } from "@/lib/creditMemo/committee/buildMemoCommitteeReadinessSection";

/**
 * BUGFIX-CANONICAL-MEMO-RENDER-COMMITTEE-READINESS-SECTION-1
 * The canonical memo print view must render memo.committee_readiness (it was
 * built + serialized but never rendered). OmniCare-shaped fixture.
 */

function omniSection(): MemoCommitteeReadinessSection {
  return {
    committee_ready: false,
    status_line: "Not ready for committee review.",
    remaining_blockers: ["Management support missing", "Industry source review required", "Analyst conclusion missing"],
    decision_support: [
      {
        group_id: "industry", domain: "Industry Validation", recommendation: "Approve with caveat", confidence: "Medium",
        conclusion: "Buddy understands the borrower's industry from NAICS 561422; an independent industry source is on file.",
        evidence: ["Census industry source — supported by public source"], caveats: ["Source review required before committee readiness"],
      },
      {
        group_id: "scale", domain: "Business Scale", recommendation: "Approve with caveat", confidence: "Medium",
        conclusion: "Scale appears supported by file evidence.",
        evidence: ["Revenue support — supported by file evidence"], caveats: ["Analyst scale-plausibility conclusion still required"],
      },
    ],
    sources: [
      { label: "Census — NAICS 561422", url: "https://data.census.gov/cedsci/all?q=NAICS%20561422", evidence_label: "supported by public source", review_state: "needs_review", committee_approved: false },
    ],
    markdown: "…",
  };
}

const render = (section: MemoCommitteeReadinessSection | null) =>
  renderToStaticMarkup(React.createElement(CommitteeReadinessSection, { section }));

describe("CommitteeReadinessSection render", () => {
  it("renders the section heading + status line when present", () => {
    const html = render(omniSection());
    assert.match(html, /data-testid="memo-committee-readiness"/);
    assert.match(html, /Committee Readiness and Evidence Status/);
    assert.match(html, /Not ready for committee review\./);
  });

  it("renders all remaining blockers (review-required, not 'missing' for industry)", () => {
    const html = render(omniSection());
    assert.match(html, /Management support missing/);
    assert.match(html, /Industry source review required/);
    assert.match(html, /Analyst conclusion missing/);
    assert.doesNotMatch(html, /Industry support missing/);
  });

  it("renders decision support with the Business Scale analyst-conclusion caveat", () => {
    const html = render(omniSection());
    assert.match(html, /Business Scale/);
    assert.match(html, /Approve with caveat/);
    assert.match(html, /Analyst scale-plausibility conclusion still required/);
    assert.match(html, /supported by file evidence/);
  });

  it("renders sources without implying committee approval", () => {
    const html = render(omniSection());
    assert.match(html, /Census — NAICS 561422/);
    assert.match(html, /supported by public source/);
    assert.match(html, /not committee-approved/);
  });

  it("renders nothing when committee_readiness is null", () => {
    assert.equal(render(null), "");
  });
});

describe("placement (structural)", () => {
  it("is rendered between the Executive Takeaway and the Financing Request box", () => {
    const src = fs.readFileSync(new URL("../CanonicalMemoTemplate.tsx", import.meta.url), "utf8");
    const takeaway = src.indexOf("Credit Officer Executive Takeaway");
    const committee = src.indexOf("<CommitteeReadinessSection section={memo.committee_readiness}");
    const financing = src.indexOf("FINANCING REQUEST BOX");
    assert.ok(takeaway >= 0 && committee >= 0 && financing >= 0, "anchors present");
    assert.ok(takeaway < committee && committee < financing, "committee section sits between takeaway and financing");
  });
});
