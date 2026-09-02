import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CrmHomeWorkbench } from "../CrmHomeWorkbench";
import { CrmCompanyCards } from "../CrmCompanyCards";
import { CrmTaskControl } from "../CrmTaskControl";
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
test("home offers real intake and complete task inventory without inventing pipeline counts", () => {
  const html = renderToStaticMarkup(
    React.createElement(CrmHomeWorkbench, props),
  );
  assert.match(html, /leads\?new=1/);
  assert.match(html, /Team commitments/);
  assert.match(html, /Completed · reopen/);
  assert.match(html, /Loading lead follow-ups/);
  assert.match(html, /This is not a complete task inventory/);
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
