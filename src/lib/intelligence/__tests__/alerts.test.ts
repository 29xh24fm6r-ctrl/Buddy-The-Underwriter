import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();

const require = createRequire(import.meta.url);
const { FakeDb } = require("./testFakeDb") as typeof import("./testFakeDb");
const alerts = require("../alerts") as typeof import("../alerts");
const alertFeedback = require("../alertFeedback") as typeof import("../alertFeedback");

const BANK_A = "bank-a";
const BANK_B = "bank-b";

function overdueTaskDb() {
  return new FakeDb({
    deals: [{ id: "d1", bank_id: BANK_A }],
    brokerage_tasks: [{ id: "t1", bank_id: BANK_A, deal_id: "d1", title: "Chase document", due_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), status: "open" }],
  });
}

test("alert determinism: the same input state produces the same alert set on repeated calls", async () => {
  const db = overdueTaskDb();
  const first = await alerts.computeIntelligenceAlerts(BANK_A, null, db as any);
  const second = await alerts.computeIntelligenceAlerts(BANK_A, null, db as any);
  assert.deepEqual(
    first.map((a) => a.alertKey + a.entityId),
    second.map((a) => a.alertKey + a.entityId),
  );
  assert.ok(first.some((a) => a.alertKey === "task_overdue" && a.entityId === "t1"));
});

test("explainability payload: every alert carries recommendation, severity, evidence, source rule, and action route", async () => {
  const db = overdueTaskDb();
  const found = await alerts.computeIntelligenceAlerts(BANK_A, null, db as any);
  const alert = found.find((a) => a.alertKey === "task_overdue")!;
  assert.ok(alert.recommendation.length > 0);
  assert.ok(["critical", "high", "medium", "low"].includes(alert.severity));
  assert.ok(Array.isArray(alert.evidence) && alert.evidence.length > 0, "evidence must cite the underlying data, not just assert a claim");
  assert.ok(alert.sourceRule.length > 0, "the triggering rule must be visible");
  assert.ok(alert.actionRoute && alert.actionRoute.length > 0);
});

test("dismiss and snooze: a dismissed alert is excluded from the next computation", async () => {
  const db = overdueTaskDb();
  const before = await alerts.computeIntelligenceAlerts(BANK_A, null, db as any);
  assert.ok(before.some((a) => a.alertKey === "task_overdue" && a.entityId === "t1"));

  await alertFeedback.setAlertFeedback({ bankId: BANK_A, entityType: "task", entityId: "t1", alertKey: "task_overdue", state: "dismissed", reason: "already being handled" }, db as any);

  const after = await alerts.computeIntelligenceAlerts(BANK_A, null, db as any);
  assert.ok(!after.some((a) => a.alertKey === "task_overdue" && a.entityId === "t1"), "a dismissed alert must not reappear");
});

test("dismiss and snooze: a snoozed-until-the-future alert is excluded; an expired snooze reappears", async () => {
  const db = overdueTaskDb();
  const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await alertFeedback.setAlertFeedback({ bankId: BANK_A, entityType: "task", entityId: "t1", alertKey: "task_overdue", state: "snoozed", reason: "will check tomorrow", snoozeUntilIso: future }, db as any);
  const whileSnoozed = await alerts.computeIntelligenceAlerts(BANK_A, null, db as any);
  assert.ok(!whileSnoozed.some((a) => a.alertKey === "task_overdue" && a.entityId === "t1"));

  const past = new Date(Date.now() - 1000).toISOString();
  await alertFeedback.setAlertFeedback({ bankId: BANK_A, entityType: "task", entityId: "t1", alertKey: "task_overdue", state: "snoozed", reason: "will check tomorrow", snoozeUntilIso: past }, db as any);
  const afterExpiry = await alerts.computeIntelligenceAlerts(BANK_A, null, db as any);
  assert.ok(afterExpiry.some((a) => a.alertKey === "task_overdue" && a.entityId === "t1"), "an expired snooze must not keep suppressing the alert");
});

test("dismiss and snooze: dismiss_count increments and last_dismissed_at is stamped on repeated dismissals", async () => {
  const db = overdueTaskDb();
  await alertFeedback.setAlertFeedback({ bankId: BANK_A, entityType: "task", entityId: "t1", alertKey: "task_overdue", state: "dismissed", reason: "first" }, db as any);
  const second = await alertFeedback.setAlertFeedback({ bankId: BANK_A, entityType: "task", entityId: "t1", alertKey: "task_overdue", state: "dismissed", reason: "second" }, db as any);
  assert.equal(second.dismiss_count, 2);
  assert.ok(second.last_dismissed_at);
});

test("personal vs team-wide dismissal: a personal dismissal does not hide the alert for other staff", async () => {
  const db = overdueTaskDb();
  await alertFeedback.setAlertFeedback({ bankId: BANK_A, entityType: "task", entityId: "t1", alertKey: "task_overdue", state: "dismissed", reason: "not my problem", userId: "user-1" }, db as any);

  const forUser1 = await alerts.computeIntelligenceAlerts(BANK_A, "user-1", db as any);
  assert.ok(!forUser1.some((a) => a.entityId === "t1"));

  const forUser2 = await alerts.computeIntelligenceAlerts(BANK_A, "user-2", db as any);
  assert.ok(forUser2.some((a) => a.entityId === "t1"), "another user's personal dismissal must not suppress the alert for me");
});

test("tenant isolation: alerts never cross banks", async () => {
  const db = new FakeDb({
    deals: [
      { id: "d1", bank_id: BANK_A },
      { id: "d2", bank_id: BANK_B },
    ],
    brokerage_tasks: [
      { id: "t1", bank_id: BANK_A, deal_id: "d1", title: "A", due_at: new Date(Date.now() - 1000).toISOString(), status: "open" },
      { id: "t2", bank_id: BANK_B, deal_id: "d2", title: "B", due_at: new Date(Date.now() - 1000).toISOString(), status: "open" },
    ],
  });
  const found = await alerts.computeIntelligenceAlerts(BANK_A, null, db as any);
  assert.ok(found.every((a) => a.entityId !== "t2"));
});
