/**
 * Audit fix regression (Borrower Intake Program review, M2/M6) —
 * ConditionsToCloseCard.tsx gained two new action buttons whose backend
 * routes already existed but had zero UI entry point anywhere in the app:
 * "Log lender follow-up" (M2) and "Re-run hostile committee review" (M6).
 * renderToStaticMarkup doesn't run effects, so the initial fetch in
 * useEffect never fires — this is a pure structural render check, same
 * convention as fixCardsPanelRender.test.ts / glassBoxPanelRender.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ConditionsToCloseCard from "@/components/deals/ConditionsToCloseCard";

test("renders both audit-fix action buttons", () => {
  const html = renderToStaticMarkup(React.createElement(ConditionsToCloseCard, { dealId: "deal-1" }));
  assert.ok(html.includes("Log lender follow-up"));
  assert.ok(html.includes("Re-run hostile committee review"));
  assert.ok(html.includes("Generate from Mitigants"), "existing action must still render");
});
