import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BrokerageStart } from "../BrokerageStart";

test("brokerage home offers the real staff workflows without routing to bank deals", () => {
  const html = renderToStaticMarkup(React.createElement(BrokerageStart));
  for (const href of ["/admin/brokerage/pipeline", "/admin/brokerage/pipeline/new", "/admin/brokerage/crm", "/admin/brokerage/crm/buyers", "/admin/brokerage/team", "/admin/brokerage/billing"]) {
    assert.ok(html.includes(`href="${href}"`), href);
  }
  assert.doesNotMatch(html, /href="\/deals"/);
  assert.match(html, /Documents and underwriting stay attached to each deal/);
  assert.match(html, /<h1/);
});
