import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrokerageStart } from "../BrokerageStart";
import fs from "node:fs";
import path from "node:path";

test("brokerage home offers the real staff workflows without routing to bank deals", () => {
  const html = renderToStaticMarkup(React.createElement(BrokerageStart));
  for (const href of ["/admin/brokerage/pipeline", "/admin/brokerage/pipeline/new", "/admin/brokerage/crm", "/admin/brokerage/crm/buyers", "/admin/brokerage/team", "/admin/brokerage/billing", "/admin/brokerage/owner"]) {
    assert.ok(html.includes(`href="${href}"`), href);
  }
  assert.doesNotMatch(html, /href="\/deals"/);
  assert.doesNotMatch(html, /href="\/admin\/brokerage-owner"/);
  assert.match(html, /Documents and underwriting stay attached to each deal/);
  assert.match(html, /<h1/);
});

test("brokerage home renders the HQ instead of redirecting back to CRM", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/app/admin/brokerage/page.tsx"), "utf8");
  assert.doesNotMatch(source, /redirect\(/);
  assert.match(source, /return null/);
});
