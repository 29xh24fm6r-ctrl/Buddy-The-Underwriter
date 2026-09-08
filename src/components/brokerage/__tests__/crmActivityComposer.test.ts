import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CrmActivityComposer } from "../CrmActivityComposer";
import { CrmToday } from "../CrmToday";

test("composer exposes labeled controls and makes logging semantics explicit", () => {
  const html = renderToStaticMarkup(React.createElement(CrmActivityComposer, { organizationId: "org", organizationName: "Example partner", onSaved() {} }));
  for (const text of ["Add note", "Log call", "Log meeting", "Set follow-up", "Short description", "Details (optional)", "Save activity", "Does not place a call"]) assert.ok(html.includes(text), text);
  assert.match(html, /aria-label="Record activity for Example partner"/);
  assert.doesNotMatch(html, /role="status"|Sent successfully/);
});
test("Today offers all loaded companies for quick capture, not just health suggestions", () => {
  const html = renderToStaticMarkup(React.createElement(CrmToday, { loading: false, error: null, tasks: [], relationships: [], activity: [], organizations: [{ id: "healthy", name: "Healthy partner" }], now: 0, onRetry() {} }));
  assert.match(html, /Healthy partner/);
  assert.match(html, /Record activity or set a follow-up/);
  assert.match(html, /What’s included/);
});
