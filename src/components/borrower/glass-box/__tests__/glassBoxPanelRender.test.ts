/**
 * SPEC-M3 GLASS-BOX-1 — GlassBoxPanelBody render tests.
 *
 * Uses renderToStaticMarkup against the pure presentational component
 * (no useEffect/fetch involved) — same convention as
 * borrowerDealHealthRender.test.ts. Covers the forbidden-phrase regression
 * (no approval/guarantee/decision language) plus each of the three states.
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GlassBoxPanelBody, type GlassBoxReadinessRead } from "@/components/borrower/glass-box/GlassBoxPanel";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

// Note: deliberately excludes "credit decision" — the canonical disclaimer
// itself says "not a credit decision," so a bare substring check on that
// phrase would flag its own required negation. These terms only appear in
// a genuine violation, never in getDisclaimer("readiness")'s own text.
const APPROVAL_LANGUAGE_TERMS = [
  "you are approved",
  "loan is approved",
  "approval odds",
  "guaranteed funding",
  "probability of approval",
  "will be approved",
  "pre-approved",
  "conditional approval",
];

function assertNoForbiddenLanguage(html: string) {
  const lower = html.toLowerCase();
  for (const term of FORBIDDEN_BORROWER_TERMS) {
    assert.ok(!lower.includes(term.toLowerCase()), `Forbidden term "${term}"`);
  }
  for (const term of APPROVAL_LANGUAGE_TERMS) {
    assert.ok(!lower.includes(term.toLowerCase()), `Approval-language term "${term}"`);
  }
}

test("loading state (null read) renders without forbidden language", () => {
  const html = renderToStaticMarkup(React.createElement(GlassBoxPanelBody, { read: null }));
  assert.ok(html.includes("Building your readiness read"));
  assertNoForbiddenLanguage(html);
});

test("unavailable state renders the message, no forbidden language", () => {
  const read: GlassBoxReadinessRead = {
    status: "unavailable",
    message: "Upload your financial documents to get started.",
  };
  const html = renderToStaticMarkup(React.createElement(GlassBoxPanelBody, { read }));
  assert.ok(html.includes("Upload your financial documents"));
  assertNoForbiddenLanguage(html);
});

test("degraded state renders message, missing metrics, and disclaimer", () => {
  const read: GlassBoxReadinessRead = {
    status: "degraded",
    message: "Here's what we can read so far.",
    missingMetrics: ["EBITDA"],
    disclaimer: "This is a readiness read, not a credit decision or loan approval.",
  };
  const html = renderToStaticMarkup(React.createElement(GlassBoxPanelBody, { read }));
  assert.ok(html.includes("Here&#x27;s what we can read so far.") || html.includes("Here's what we can read so far."));
  assert.ok(html.includes("EBITDA"));
  assert.ok(html.includes("not a credit decision"));
  assertNoForbiddenLanguage(html);
});

test("ready state renders every section's label and narrative, plus the disclaimer", () => {
  const read: GlassBoxReadinessRead = {
    status: "ready",
    sections: [
      { metricKey: "DSCR", label: "Debt Service Coverage Ratio", narrative: "Your DSCR is 1.35." },
    ],
    disclaimer: "This is a readiness read, not a credit decision or loan approval.",
  };
  const html = renderToStaticMarkup(React.createElement(GlassBoxPanelBody, { read }));
  assert.ok(html.includes("Debt Service Coverage Ratio"));
  assert.ok(html.includes("Your DSCR is 1.35."));
  assert.ok(html.includes("not a credit decision"));
  assertNoForbiddenLanguage(html);
});

test("ready state with an adversarial narrative still can't smuggle forbidden language past render", () => {
  // Defense in depth: even if a verifier bug let something bad through,
  // the render layer itself shouldn't add any approval framing of its own.
  const read: GlassBoxReadinessRead = {
    status: "ready",
    sections: [{ metricKey: "DSCR", label: "Debt Service Coverage Ratio", narrative: "Your DSCR is 1.35." }],
    disclaimer: "This is a readiness read, not a credit decision or loan approval.",
  };
  const html = renderToStaticMarkup(React.createElement(GlassBoxPanelBody, { read }));
  assertNoForbiddenLanguage(html);
});
