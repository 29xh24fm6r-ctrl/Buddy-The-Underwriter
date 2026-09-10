import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CrmHomeWorkbench } from "../CrmHomeWorkbench";
import { CrmCompanyCards } from "../CrmCompanyCards";
import { CrmTaskControl } from "../CrmTaskControl";
import { readFileSync } from "node:fs";
const props = {
  loading: false,
  error: null,
  tasks: [],
  relationships: [],
  activity: [],
  onRetry() {},
  now: 0,
  organizations: [],
};
test("new homepage distinguishes initial loading and failure from an empty task queue", () => {
  const loading = renderToStaticMarkup(
    React.createElement(CrmHomeWorkbench, { ...props, loading: true }),
  );
  assert.match(loading, /role="status"/);
  assert.doesNotMatch(loading, /No open/);
  const failed = renderToStaticMarkup(
    React.createElement(CrmHomeWorkbench, { ...props, error: "failed" }),
  );
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(failed, /No open/);
});
test("home loads the unified brokerage command center and preserves the full task inventory", () => {
  const source = readFileSync("src/components/brokerage/CrmHomeWorkbench.tsx", "utf8");
  assert.match(source, /crm\/command-center/);
  assert.match(source, /ACTIVE DEALS/);
  assert.match(source, /NEEDS ATTENTION/);
  assert.match(source, /ACTIVE PLACEMENTS/);
  assert.match(source, /CrmTaskInventory/);
  assert.match(source, /No totals are being presented as zero/);
  assert.match(source, /Your first real opportunity, without the learning curve/);
  assert.match(source, /Capture the opportunity/);
  assert.match(source, /work\.slice\(0, 5\)/);
  assert.match(source, /Showing the five highest priorities/);
  assert.match(source, /You cleared this view/);
  assert.match(source, /YOUR NEXT BEST MOVE/);
  assert.match(source, /OPERATING MOMENTUM/);
  assert.match(source, /How momentum is calculated/);
  assert.match(source, /Capture a lead/);
});

test("CRM guidance explains the complete brokerage lifecycle in plain language", () => {
  const frame = readFileSync("src/components/brokerage/CrmWorkspaceFrame.tsx", "utf8");
  for (const step of ["Know the relationship", "Qualify the opportunity", "Build the deal", "Place and close"]) {
    assert.match(frame, new RegExp(step));
  }
});
test("company directory preserves full record links and derived metrics", () => {
  const html = renderToStaticMarkup(
    React.createElement(CrmCompanyCards, {
      loading: false,
      error: null,
      onRetry() {},
      owners: {},
      companies: [
        {
          id: "company",
          name: "Example",
          organization_type: "referral_source",
          city: null,
          state: null,
          health: "new",
          peopleCount: 2,
          lastActivityAt: null,
          dealsReferredCount: 0,
          dealsReferredValue: 0,
          owner_clerk_user_id: null,
          tags: [],
        },
      ],
    }),
  );
  assert.match(html, /crm\/company/);
  assert.match(html, /Needs an owner/);
  assert.match(html, /Start the first conversation/);
  assert.match(html, /aria-label="Company view"/);
});
test("task controls visibly distinguish complete and reopen actions", () => {
  for (const completed of [false, true]) {
    const html = renderToStaticMarkup(
      React.createElement(CrmTaskControl, {
        id: "task",
        completed,
        onSaved() {},
      }),
    );
    assert.ok(html.includes(completed ? "Reopen task" : "✓ Complete"));
    assert.match(html, /Reschedule/);
  }
});
