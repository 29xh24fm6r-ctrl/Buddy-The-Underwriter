import test from "node:test";
import assert from "node:assert/strict";
import { buildRevenueOperatingSystem } from "../revenueOperatingSystem";

const now = new Date("2026-09-08T12:00:00.000Z");

test("combines deals, leads, relationships, lenders, and communications into one honest operating picture", () => {
  const command = buildRevenueOperatingSystem({
    now,
    deals: [
      { id: "d1", title: "Cafe", borrower: "Dana", amount: 500_000, stage: "intake", stageEnteredAt: "2026-08-01T12:00:00.000Z", ownerClerkUserId: null, banksSent: 0, nextTask: null },
      { id: "d2", title: "Funded", borrower: "Lee", amount: 1_000_000, stage: "funded", stageEnteredAt: "2026-09-01T12:00:00.000Z", ownerClerkUserId: "u1", banksSent: 2, nextTask: null },
      { id: "d3", title: "Parked", borrower: null, amount: 200_000, stage: "lost", stageEnteredAt: "2026-08-01T12:00:00.000Z", ownerClerkUserId: null, banksSent: 1, nextTask: null },
    ],
    leads: [
      { id: "l1", status: "new", business_name: "New Co" },
      { id: "l2", status: "converted", business_name: "Done Co" },
    ],
    organizations: [{ id: "o1", name: "CPA", ownerClerkUserId: null }],
    unlinkedPeople: 1,
    lenders: [{ id: "p1", name: "Bank", hasAppetite: false, hasGeography: false, contactCount: 0 }],
    activeSubmissions: 0,
    templates: { active: 1, possible: 4 },
  });

  assert.deepEqual(command.metrics, {
    activeDeals: 1,
    pipelineValue: 500_000,
    needsAttention: 1,
    unassignedDeals: 1,
    activeLeads: 1,
    convertedLeads: 1,
    relationships: 1,
    activeSubmissions: 0,
  });
  assert.deepEqual(command.work[0].reasons, ["Needs an owner", "No next action", "Stalled in stage"]);
  assert.equal(command.work[0].severity, "critical");
  assert.equal(command.health.templatePercent, 25);
  assert.equal(command.setup.complete, 0);
  assert.equal(command.setup.total, 6);
  assert.equal(command.momentum.percent, 5);
  assert.equal(command.momentum.level, "Launchpad");
  assert.equal(command.momentum.nextLevelAt, 20);
  assert.deepEqual(command.momentum.signals.map((signal) => signal.percent), [0, 0, 0, 0, 25]);
  assert.equal(command.momentum.signals[0].href, "/admin/brokerage/pipeline?owner=unassigned");
  assert.deepEqual(command.executive, {
    ownershipCoverage: 0,
    nextActionCoverage: 0,
    averageStageAgeDays: 38,
    criticalPipelineValue: 500_000,
    distributedDeals: 0,
    overdueDeals: 0,
  });
});

test("does not manufacture attention work when the operating record is complete", () => {
  const command = buildRevenueOperatingSystem({
    now,
    deals: [{ id: "d1", title: "Cafe", borrower: "Dana", amount: 500_000, stage: "packaging", stageEnteredAt: "2026-09-07T12:00:00.000Z", ownerClerkUserId: "u1", banksSent: 1, nextTask: { id: "t1", title: "Review package", dueAt: "2026-09-10T12:00:00.000Z" } }],
    leads: [], organizations: [], unlinkedPeople: 0,
    lenders: [{ id: "p1", name: "Bank", hasAppetite: true, hasGeography: true, contactCount: 1 }],
    activeSubmissions: 1, templates: { active: 4, possible: 4 },
  });
  assert.equal(command.metrics.needsAttention, 0);
  assert.deepEqual(command.work, []);
  assert.equal(command.setup.items.find((item) => item.id === "lenders")?.complete, true);
  assert.equal(command.momentum.percent, 100);
  assert.equal(command.momentum.level, "Brokerage mastery");
  assert.equal(command.momentum.nextLevel, null);
  assert.equal(command.executive.ownershipCoverage, 100);
  assert.equal(command.executive.nextActionCoverage, 100);
  assert.equal(command.executive.distributedDeals, 1);
});
