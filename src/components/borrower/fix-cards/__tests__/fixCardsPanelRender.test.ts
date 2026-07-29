/**
 * SPEC-M4 FIX-CARDS-1 — FixCardsPanelBody render tests.
 * Same convention as glassBoxPanelRender.test.ts (M3).
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FixCardsPanelBody, type FixCard } from "@/components/borrower/fix-cards/FixCardsPanel";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

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

test("loading state (null cards) renders without forbidden language", () => {
  const html = renderToStaticMarkup(React.createElement(FixCardsPanelBody, { cards: null }));
  assert.ok(html.includes("Checking your package"));
  assertNoForbiddenLanguage(html);
});

test("empty state renders 'all caught up' message", () => {
  const html = renderToStaticMarkup(React.createElement(FixCardsPanelBody, { cards: [] }));
  assert.ok(html.includes("all caught up"));
  assertNoForbiddenLanguage(html);
});

test("renders every card's what/whyItMatters/resolvingAction", () => {
  const cards: FixCard[] = [
    {
      issueType: "checklist_gap:tax_return_2024",
      severity: "info",
      what: "We still need: 2024 Business Tax Return.",
      whyItMatters: "Lenders need your most recent filing to verify income.",
      resolvingAction: "Upload your 2024 Business Tax Return.",
      checklistKey: "tax_return_2024",
    },
    {
      issueType: "risk_flag:DSCR",
      severity: "critical",
      what: "Your Debt Service Coverage Ratio of 1.1 is below the typical minimum of 1.25.",
      whyItMatters: "Lenders use DSCR to gauge repayment cushion.",
      resolvingAction: "Upload documentation for any add-backs that support your cash flow calculation.",
    },
  ];
  const html = renderToStaticMarkup(React.createElement(FixCardsPanelBody, { cards }));
  assert.ok(html.includes("2024 Business Tax Return"));
  assert.ok(html.includes("Lenders need your most recent filing"));
  assert.ok(html.includes("Debt Service Coverage Ratio"));
  assert.ok(html.includes("add-backs"));
  assertNoForbiddenLanguage(html);
});
