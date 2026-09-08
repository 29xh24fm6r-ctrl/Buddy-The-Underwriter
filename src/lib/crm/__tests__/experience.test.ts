import test from "node:test";
import assert from "node:assert/strict";
import { CRM_ROOT, crmSection, isCrmExperienceEnabled, prioritizeTasks, taskDueLabel } from "../experience";

test("experience opt-in fails closed for missing and malformed flag values", () => {
  for (const value of [undefined, "", "false", "1", "TRUE", " true "]) assert.equal(isCrmExperienceEnabled(value), false);
  assert.equal(isCrmExperienceEnabled("true"), true);
});

test("canonical routes map to five workspaces without changing record identities", () => {
  assert.equal(crmSection(CRM_ROOT, null), "today");
  assert.equal(crmSection(CRM_ROOT, "unknown"), "today");
  assert.equal(crmSection(CRM_ROOT, "relationships"), "relationships");
  for (const [path, section] of [["leads/123", "pipeline"], ["buyers", "lenders"], ["people/123", "relationships"], ["relationships", "relationships"], ["123", "relationships"], ["dedup", "tools"], ["templates", "tools"]]) {
    assert.equal(crmSection(`${CRM_ROOT}/${path}`, null), section);
  }
});

test("tasks prioritize valid due dates without mutating the API response", () => {
  const tasks = [null, "invalid", "2026-09-03T00:00:00Z", "2026-09-01T00:00:00Z"].map((due_at, i) => ({ id: String(i), due_at, title: null, organizationId: null, organizationName: null }));
  assert.deepEqual(prioritizeTasks(tasks).map((task) => task.id), ["3", "2", "0", "1"]);
  assert.deepEqual(tasks.map((task) => task.id), ["0", "1", "2", "3"]);
});

test("missing dates stay unknown and due dates have deterministic timezone labels", () => {
  const now = Date.parse("2026-09-02T12:00:00Z");
  assert.equal(taskDueLabel(null, now), "No due date");
  assert.equal(taskDueLabel("bad", now), "No due date");
  assert.equal(taskDueLabel("2026-09-01T00:00:00Z", now), "Overdue");
  assert.equal(taskDueLabel("2026-09-03T00:00:00Z", now), "Due Sep 3 (UTC)");
});
