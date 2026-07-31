/**
 * SPEC-TRIDENT-FIX-VERIFY-AND-REDO-V1 — MemoPreview render tests. Same
 * renderToStaticMarkup convention as fixCardsPanelRender.test.ts /
 * glassBoxPanelRender.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoPreview } from "@/components/ai/GenerateCreditMemoPanel";

test("renders nothing before a memo has been generated", () => {
  const html = renderToStaticMarkup(React.createElement(MemoPreview, { memoHtml: null, isFallbackStub: false }));
  assert.equal(html, "");
});

test("a real memo shows the plain 'Preview (HTML)' header with no placeholder warning", () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoPreview, { memoHtml: "<p>real memo</p>", isFallbackStub: false }),
  );
  assert.ok(html.includes("Preview (HTML)"));
  assert.ok(!html.includes("PLACEHOLDER"));
  assert.ok(!html.includes("Placeholder memo"));
});

test("a fallback stub memo is visibly distinguishable: warning banner + amber header, not indistinguishable from a real memo", () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoPreview, { memoHtml: "<p>stub memo</p>", isFallbackStub: true }),
  );
  assert.ok(html.includes("Placeholder memo"));
  assert.ok(html.includes("NOT a real"));
  assert.ok(html.includes("PLACEHOLDER, not AI-generated"));
  assert.ok(html.includes('role="alert"'));
});
