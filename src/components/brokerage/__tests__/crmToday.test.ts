import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { CrmToday } from "../CrmToday";
import { CrmWorkspaceNav } from "../CrmWorkspaceNav";

const defaults = { loading: false, error: null, tasks: [], relationships: [], activity: [], now: Date.parse("2026-09-02T12:00:00Z"), onRetry() {} };
const render = (overrides: Partial<React.ComponentProps<typeof CrmToday>> = {}) => renderToStaticMarkup(React.createElement(CrmToday, { ...defaults, ...overrides }));

test("grouped navigation retains contact and tool routes with active context", () => {
  const relationships = renderToStaticMarkup(React.createElement(CrmWorkspaceNav, { section: "relationships", pathname: "/admin/brokerage/crm/people/person-1" }));
  assert.match(relationships, /aria-label="Relationships views"/);
  assert.match(relationships, /href="\/admin\/brokerage\/crm\/people"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/brokerage\/crm\/people"/);
  const tools = renderToStaticMarkup(React.createElement(CrmWorkspaceNav, { section: "tools", pathname: "/admin/brokerage/crm/dedup" }));
  assert.match(tools, /Duplicate review/);
  assert.match(tools, /Message templates/);
  assert.match(tools, /href="\/admin\/brokerage\/crm\/buyers"/);
});

test("loading and failed reads never claim the user is caught up", () => {
  const loading = render({ loading: true });
  assert.match(loading, /role="status"/);
  assert.doesNotMatch(loading, /No open tasks|No relationships flagged/);
  const failed = render({ error: "Unavailable" });
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Try again/);
  assert.doesNotMatch(failed, /No open tasks|No relationships flagged/);
});

test("empty overview is honest about source limits and offers real next steps", () => {
  const html = render();
  assert.match(html, /latest 500 CRM activities/);
  assert.match(html, /up to 8 check-in suggestions/);
  assert.match(html, /No open tasks in this overview/);
  assert.match(html, /href="\/admin\/brokerage\/crm\/leads"/);
  assert.match(html, /view=relationships/);
});

test("tasks and check-ins link to canonical records, never send or complete automatically", () => {
  const html = render({ tasks: [{ id: "task", title: "Call partner", due_at: "2026-09-01T00:00:00Z", organizationId: "org-1", organizationName: "Test company" }], relationships: [{ id: "org-2", name: "Example partner", health: "cooling", lastActivityAt: null }] });
  assert.match(html, /Overdue/);
  assert.match(html, /href="\/admin\/brokerage\/crm\/org-1"/);
  assert.match(html, /href="\/admin\/brokerage\/crm\/org-2"/);
  assert.match(html, /No activity recorded/);
  assert.doesNotMatch(html, /Completed|Sent successfully/);
});

test("unlinked tasks remain visible without fabricated record links", () => {
  const html = render({ tasks: [{ id: "task", title: "Unlinked task", due_at: null, organizationId: null, organizationName: null }] });
  assert.match(html, /Unlinked task/);
  assert.match(html, /No organization link available/);
  assert.doesNotMatch(html, /crm\/null/);
});

test("rollout is server-controlled, preserves legacy rendering, and adds no write API", () => {
  const layout = readFileSync("src/app/admin/brokerage/crm/layout.tsx", "utf8");
  const page = readFileSync("src/app/admin/brokerage/crm/page.tsx", "utf8");
  const today = readFileSync("src/components/brokerage/CrmToday.tsx", "utf8");
  assert.match(layout, /isCrmExperienceEnabled\(process.env.BUDDY_CRM_EXPERIENCE_V2_ENABLED\)/);
  assert.match(layout, /<Suspense/);
  assert.match(page, /enabled && section === "today"/);
  assert.match(page, /!enabled && <>/);
  assert.doesNotMatch(today, /fetch\(|localStorage|sessionStorage/);
});
