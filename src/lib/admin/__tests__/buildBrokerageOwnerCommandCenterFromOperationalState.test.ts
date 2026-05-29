import test from "node:test";
import assert from "node:assert/strict";

/**
 * Adapter tests for buildBrokerageOwnerCommandCenterFromOperationalState
 *
 * Tests the pure mapping helpers exported for testing. The main adapter
 * function requires a live Supabase connection, so we test the mapping
 * layer and verify invariants on the pure builder path.
 *
 * Spec: 16B / Spec 18 — Owner/Admin Command Center Route Integration
 */

import {
  mapDealRowToRecord,
  mapEventToActivity,
  humanizeEventType,
  categorizeEvent,
  type DealRow,
  type DealEventRow,
} from "@/lib/admin/brokerageOwnerOperationalMapping";
import {
  buildBrokerageOwnerCommandCenterViewModel,
  type BrokerageOwnerCommandCenterInput,
  type BrokerageDealRecord,
} from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";

// ---------------------------------------------------------------------------
// Guard 1: mapDealRowToRecord produces valid BrokerageDealRecord
// ---------------------------------------------------------------------------

test("mapDealRowToRecord maps business_name as borrowerLabel", () => {
  const row: DealRow = {
    id: "deal-001",
    borrower_name: "John Doe",
    business_name: "Acme Corp",
    created_by_user_id: "user-1",
    updated_at: "2026-05-20T12:00:00Z",
  };
  const record = mapDealRowToRecord(row);
  assert.equal(record.dealId, "deal-001");
  assert.equal(record.borrowerLabel, "Acme Corp");
  assert.equal(record.assignedTeamMemberId, "user-1");
  assert.equal(record.lastActivityAt, "2026-05-20T12:00:00Z");
});

test("mapDealRowToRecord falls back to borrower_name when business_name empty", () => {
  const row: DealRow = {
    id: "deal-002",
    borrower_name: "Jane Smith",
    business_name: "",
    created_by_user_id: null,
    updated_at: null,
  };
  const record = mapDealRowToRecord(row);
  assert.equal(record.borrowerLabel, "Jane Smith");
  assert.equal(record.assignedTeamMemberId, null);
  assert.equal(record.lastActivityAt, null);
});

test("mapDealRowToRecord uses 'Unnamed deal' when both names missing", () => {
  const row: DealRow = {
    id: "deal-003",
    borrower_name: null,
    business_name: null,
    created_by_user_id: null,
    updated_at: null,
  };
  const record = mapDealRowToRecord(row);
  assert.equal(record.borrowerLabel, "Unnamed deal");
});

// ---------------------------------------------------------------------------
// Guard 2: mapEventToActivity produces valid BrokerageActivityEvent
// ---------------------------------------------------------------------------

test("mapEventToActivity maps event row to activity event", () => {
  const row: DealEventRow = {
    id: "evt-001",
    deal_id: "deal-001",
    kind: "borrower_document_uploaded",
    created_at: "2026-05-20T14:00:00Z",
    payload: null,
  };
  const event = mapEventToActivity(row);
  assert.equal(event.id, "evt-001");
  assert.equal(event.category, "borrower");
  assert.equal(event.timestamp, "2026-05-20T14:00:00Z");
  assert.ok(event.label.length > 0);
});

// ---------------------------------------------------------------------------
// Guard 3: categorizeEvent dispatches correctly
// ---------------------------------------------------------------------------

test("categorizeEvent: submission before borrower (substring dispatch order)", () => {
  // "submission" is more specific — check it wins over less-specific tokens
  assert.equal(categorizeEvent("submission_created"), "submission");
  assert.equal(categorizeEvent("routing_review_started"), "routing");
  assert.equal(categorizeEvent("clarification_opened"), "clarification");
  assert.equal(categorizeEvent("borrower_document_uploaded"), "borrower");
  assert.equal(categorizeEvent("deal_created"), "operations");
});

// ---------------------------------------------------------------------------
// Guard 4: humanizeEventType converts snake_case to readable labels
// ---------------------------------------------------------------------------

test("humanizeEventType converts snake_case event types", () => {
  assert.equal(humanizeEventType("borrower_document_uploaded"), "Borrower Document Uploaded");
  assert.equal(humanizeEventType("deal_created"), "Deal Created");
});

// ---------------------------------------------------------------------------
// Guard 5: Minimal / empty input produces honest empty state
// ---------------------------------------------------------------------------

test("empty deals input produces zero-deal view model with honest headline", () => {
  const input: BrokerageOwnerCommandCenterInput = {
    deals: [],
  };
  const vm = buildBrokerageOwnerCommandCenterViewModel(input);
  assert.equal(vm.pipeline.activeDeals, 0);
  assert.ok(vm.headline.toLowerCase().includes("no active deals"));
  assert.equal(vm.bottlenecks.length, 0);
  assert.equal(vm.workload.length, 0);
  assert.equal(vm.executiveAttention.length, 0);
  assert.equal(vm.activity.length, 0);
});

// ---------------------------------------------------------------------------
// Guard 6: Real deal records map into owner command center correctly
// ---------------------------------------------------------------------------

test("real deal records produce non-zero pipeline summary", () => {
  const deals: BrokerageDealRecord[] = [
    { dealId: "d1", borrowerLabel: "Acme Corp", lastActivityAt: "2026-05-19T12:00:00Z" },
    { dealId: "d2", borrowerLabel: "Beta LLC", lastActivityAt: "2026-05-18T12:00:00Z" },
    { dealId: "d3", borrowerLabel: "Gamma Inc", lastActivityAt: "2026-05-01T12:00:00Z" },
  ];
  const input: BrokerageOwnerCommandCenterInput = {
    deals,
    evaluatedAt: "2026-05-20T12:00:00Z",
  };
  const vm = buildBrokerageOwnerCommandCenterViewModel(input);
  assert.equal(vm.pipeline.activeDeals, 3);
  assert.ok(vm.headline.includes("3"));
});

// ---------------------------------------------------------------------------
// Guard 7: Missing operational state does NOT create fake metrics
// ---------------------------------------------------------------------------

test("missing orchestration/continuity/routing does not invent metrics", () => {
  const deals: BrokerageDealRecord[] = [
    { dealId: "d1", borrowerLabel: "Test" },
  ];
  const input: BrokerageOwnerCommandCenterInput = { deals };
  const vm = buildBrokerageOwnerCommandCenterViewModel(input);

  // No orchestration → zero submission pipeline counts
  for (const s of vm.submissionPipeline) {
    assert.equal(s.count, 0, `State ${s.state} should be 0 without orchestration`);
  }
  // No continuity → zero banker action
  assert.equal(vm.pipeline.bankerActionRequired, 0);
  assert.equal(vm.pipeline.borrowerActionRequired, 0);
  // No routing → zero routing readiness
  assert.equal(vm.pipeline.routingReviewReady, 0);
});

// ---------------------------------------------------------------------------
// Guard 8: No fake timestamps in output
// ---------------------------------------------------------------------------

test("no fake timestamps: activity events only have real timestamps from input", () => {
  const deals: BrokerageDealRecord[] = [
    { dealId: "d1", borrowerLabel: "Test" },
  ];
  const activity = [
    { id: "a1", label: "Document uploaded", category: "borrower" as const },
  ];
  const input: BrokerageOwnerCommandCenterInput = { deals, activity };
  const vm = buildBrokerageOwnerCommandCenterViewModel(input);

  // Activity without timestamp should not have one fabricated
  for (const event of vm.activity) {
    if (event.id === "activity_a1") {
      assert.equal(event.timestamp, undefined, "Should not fabricate timestamp");
    }
  }
});

// ---------------------------------------------------------------------------
// Guard 9: No approval/funding language in output
// ---------------------------------------------------------------------------

test("no approval or funding language in view model strings", () => {
  const deals: BrokerageDealRecord[] = [
    { dealId: "d1", borrowerLabel: "Test Deal" },
  ];
  const input: BrokerageOwnerCommandCenterInput = { deals };
  const vm = buildBrokerageOwnerCommandCenterViewModel(input);

  const allStrings = [
    vm.headline,
    vm.summary,
    ...vm.dailyBrief,
    ...vm.bottlenecks.map((b) => b.label + " " + b.description),
    ...vm.executiveAttention.map((e) => e.label + " " + e.reason),
  ].join(" ");

  const forbidden = [
    "approved",
    "approval",
    "funded",
    "funding",
    "declined",
    "denied",
    "revenue",
    "forecast",
    "predicted",
    "SLA",
  ];

  for (const word of forbidden) {
    assert.ok(
      !allStrings.toLowerCase().includes(word.toLowerCase()),
      `Output should not contain "${word}" — found in: ${allStrings}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Guard 10: No internal enum leakage
// ---------------------------------------------------------------------------

test("no internal enum leakage in bottleneck or attention labels", () => {
  const deals: BrokerageDealRecord[] = [
    { dealId: "d1", borrowerLabel: "Test", assignedTeamMemberId: null },
  ];
  const input: BrokerageOwnerCommandCenterInput = { deals };
  const vm = buildBrokerageOwnerCommandCenterViewModel(input);

  const allLabels = [
    ...vm.bottlenecks.map((b) => b.label),
    ...vm.executiveAttention.map((e) => e.label),
  ];

  for (const label of allLabels) {
    assert.ok(
      !label.includes("_"),
      `Label should not contain underscores (enum leak): "${label}"`,
    );
  }
});

// ---------------------------------------------------------------------------
// Guard 11: Deterministic ordering — same input, same output
// ---------------------------------------------------------------------------

test("deterministic ordering: same input produces identical output", () => {
  const deals: BrokerageDealRecord[] = [
    { dealId: "d2", borrowerLabel: "Beta" },
    { dealId: "d1", borrowerLabel: "Alpha" },
    { dealId: "d3", borrowerLabel: "Gamma" },
  ];
  const input: BrokerageOwnerCommandCenterInput = { deals };
  const vm1 = buildBrokerageOwnerCommandCenterViewModel(input);
  const vm2 = buildBrokerageOwnerCommandCenterViewModel(input);
  assert.deepStrictEqual(vm1, vm2);
});

// ---------------------------------------------------------------------------
// Guard 12: No fake forecasting or revenue
// ---------------------------------------------------------------------------

test("view model with no submittedDeals/fundedDeals omits those fields", () => {
  const deals: BrokerageDealRecord[] = [
    { dealId: "d1", borrowerLabel: "Test" },
  ];
  const input: BrokerageOwnerCommandCenterInput = { deals };
  const vm = buildBrokerageOwnerCommandCenterViewModel(input);

  assert.equal(vm.pipeline.submittedDeals, undefined);
  assert.equal(vm.pipeline.fundedDeals, undefined);
});
