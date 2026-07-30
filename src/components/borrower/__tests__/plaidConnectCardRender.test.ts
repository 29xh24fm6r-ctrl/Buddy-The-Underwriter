/**
 * SPEC-M5 CONVERSATIONAL-INTAKE-1 — PlaidConnectCardBody render tests.
 * Same convention as fixCardsPanelRender.test.ts (M4) / glassBoxPanelRender.test.ts (M3).
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaidConnectCardBody } from "@/components/borrower/PlaidConnectCard";
import { FORBIDDEN_BORROWER_TERMS } from "@/lib/portal/borrowerSafeCopy";

function assertNoForbiddenLanguage(html: string) {
  const lower = html.toLowerCase();
  for (const term of FORBIDDEN_BORROWER_TERMS) {
    assert.ok(!lower.includes(term.toLowerCase()), `Forbidden term "${term}"`);
  }
}

test("idle state renders the connect button, enabled", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlaidConnectCardBody, { status: "idle", errorMessage: null, onConnect: () => {} }),
  );
  assert.ok(html.includes("Connect bank"));
  assert.ok(!/<button[^>]*\sdisabled(=|>|\s)/.test(html), "button must not carry the disabled attribute");
  assertNoForbiddenLanguage(html);
});

test("connecting state disables the button and changes its label", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlaidConnectCardBody, { status: "connecting", errorMessage: null, onConnect: () => {} }),
  );
  assert.ok(html.includes("Connecting"));
  assert.ok(/<button[^>]*\sdisabled(=|>|\s)/.test(html), "button must carry the disabled attribute");
});

test("connected state renders a confirmation, not the connect button", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlaidConnectCardBody, { status: "connected", errorMessage: null, onConnect: () => {} }),
  );
  assert.ok(html.includes("connected"));
  assert.ok(!html.includes("Connect bank"));
  assertNoForbiddenLanguage(html);
});

test("error state surfaces the error message", () => {
  const html = renderToStaticMarkup(
    React.createElement(PlaidConnectCardBody, {
      status: "error",
      errorMessage: "Could not start bank connection",
      onConnect: () => {},
    }),
  );
  assert.ok(html.includes("Could not start bank connection"));
});
