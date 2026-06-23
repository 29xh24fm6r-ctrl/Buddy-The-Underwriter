import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBankerCommandCenterFromDeals,
  BANKER_COMMAND_CENTER_FROM_DEALS_FALLBACKS,
} from "@/lib/banker/buildBankerCommandCenterFromDeals";
import type { BankerQueueItem as CoreBankerQueueItem } from "@/core/command-center/types";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function mkDeal(over: Partial<CoreBankerQueueItem> = {}): CoreBankerQueueItem {
  return {
    dealId: over.dealId ?? "deal-1",
    dealName: over.dealName ?? "Acme Holdings",
    borrowerName: over.borrowerName ?? "Jane Doe",
    canonicalStage: over.canonicalStage ?? "documents",
    urgencyBucket: over.urgencyBucket ?? "watch",
    urgencyScore: over.urgencyScore ?? 50,
    queueDomain: over.queueDomain ?? "documents",
    queueReasonCode: over.queueReasonCode ?? "uploads_waiting_review",
    queueReasonLabel: over.queueReasonLabel ?? "Uploads waiting review",
    queueReasonDescription:
      over.queueReasonDescription ?? "Borrower has uploaded items awaiting review",
    blockingParty: over.blockingParty ?? "buddy",
    primaryActionCode: over.primaryActionCode ?? null,
    primaryActionLabel: over.primaryActionLabel ?? null,
    primaryActionPriority: over.primaryActionPriority ?? null,
    primaryActionAgeHours: over.primaryActionAgeHours ?? null,
    isActionExecutable: over.isActionExecutable ?? false,
    actionability: over.actionability ?? "review_required",
    href: over.href ?? null,
    activeEscalationCount: over.activeEscalationCount ?? 0,
    borrowerOverdueCount: over.borrowerOverdueCount ?? 0,
    reviewBacklogCount: over.reviewBacklogCount ?? 0,
    latestActivityAt: over.latestActivityAt ?? null,
    changedSinceViewed: over.changedSinceViewed ?? false,
  };
}

// ---------------------------------------------------------------------------
// 1. Real deal list maps in
// ---------------------------------------------------------------------------

test("real deal list maps into command center items", () => {
  const deals = [
    mkDeal({ dealId: "d-1" }),
    mkDeal({ dealId: "d-2", blockingParty: "borrower" }),
    mkDeal({
      dealId: "d-3",
      queueReasonCode: "readiness_blocked",
      queueReasonLabel: "Readiness blocked",
    }),
  ];
  const vm = buildBankerCommandCenterFromDeals({ deals });
  assert.equal(vm.summary.totalDeals, 3);
  const allIds = vm.sections.flatMap((s) => s.items.map((i) => i.dealId));
  // All deals remain represented.
  for (const d of deals) assert.ok(allIds.includes(d.dealId));
});

// ---------------------------------------------------------------------------
// 2. Missing borrower intelligence falls back safely
// ---------------------------------------------------------------------------

test("borrower-intelligence-less deals get fallback labels", () => {
  const deals = [mkDeal({ dealId: "d-1" })];
  const vm = buildBankerCommandCenterFromDeals({ deals });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.ok(item);
  assert.equal(
    item.readinessLabel,
    BANKER_COMMAND_CENTER_FROM_DEALS_FALLBACKS.readinessLabel,
  );
  assert.equal(
    item.trustReviewLabel,
    BANKER_COMMAND_CENTER_FROM_DEALS_FALLBACKS.trustReviewLabel,
  );
});

// ---------------------------------------------------------------------------
// 3. No fake timestamps emitted
// ---------------------------------------------------------------------------

test("deals without latestActivityAt receive no synthetic timestamps", () => {
  const deals = [mkDeal({ dealId: "d-1", latestActivityAt: null })];
  const vm = buildBankerCommandCenterFromDeals({
    deals,
    evaluatedAt: "2026-05-20T00:00:00.000Z",
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.lastActivityAt, undefined);
  assert.equal(item?.staleness, undefined);
  assert.equal(item?.daysSinceLastActivity, undefined);
});

test("stalled label only emitted when evaluatedAt provided and activity is old", () => {
  const deals = [
    mkDeal({
      dealId: "d-old",
      latestActivityAt: "2026-04-01T00:00:00.000Z",
      // Use a queue reason that maps to borrower_action_required so it can be
      // escalated to "stalled" under our category-upgrade rule.
      queueReasonCode: "annual_review_collecting",
      blockingParty: "borrower",
    }),
  ];
  const noEval = buildBankerCommandCenterFromDeals({ deals });
  const noEvalItem = noEval.sections.flatMap((s) => s.items)[0];
  assert.equal(noEvalItem?.staleness, undefined);

  const evaluated = buildBankerCommandCenterFromDeals({
    deals,
    evaluatedAt: "2026-05-20T00:00:00.000Z",
  });
  const item = evaluated.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.staleness, "stalled");
});

// ---------------------------------------------------------------------------
// 4. Route hrefs preserved
// ---------------------------------------------------------------------------

test("href passes through verbatim when present", () => {
  const deals = [mkDeal({ dealId: "d-1", href: "/banker/deals/d-1/discovery" })];
  const vm = buildBankerCommandCenterFromDeals({ deals });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.href, "/banker/deals/d-1/discovery");
});

test("missing href yields no href on the queue item (no dead CTA)", () => {
  const deals = [mkDeal({ dealId: "d-1", href: null })];
  const vm = buildBankerCommandCenterFromDeals({ deals });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.href, undefined);
});

// ---------------------------------------------------------------------------
// 5. Queue categories derived conservatively
// ---------------------------------------------------------------------------

test("queue category derives from queue reason code when specific", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({
        dealId: "d-1",
        queueReasonCode: "uploads_waiting_review",
        blockingParty: "buddy",
      }),
    ],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.queueCategory, "ready_for_banker_review");
});

test("queue category falls back to blockingParty when reason code is generic", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({
        dealId: "d-1",
        queueReasonCode: "borrower_items_overdue", // explicitly stalled-style
        blockingParty: "borrower",
      }),
    ],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  // borrower_items_overdue is treated as stalled (operational honesty).
  assert.equal(item?.queueCategory, "stalled");
});

test("unknown blockingParty maps to monitoring", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({
        dealId: "d-1",
        queueReasonCode: "healthy_monitoring",
        blockingParty: "unknown",
      }),
    ],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.queueCategory, "monitoring");
});

// ---------------------------------------------------------------------------
// 6. All deals remain represented
// ---------------------------------------------------------------------------

test("every input deal appears in the output regardless of category", () => {
  const deals = Array.from({ length: 20 }, (_, i) =>
    mkDeal({
      dealId: `d-${String(i).padStart(2, "0")}`,
      blockingParty: (["borrower", "banker", "buddy", "mixed", "unknown"] as const)[i % 5],
      urgencyBucket: (["healthy", "watch", "urgent", "critical"] as const)[i % 4],
    }),
  );
  const vm = buildBankerCommandCenterFromDeals({ deals });
  const allIds = new Set(vm.sections.flatMap((s) => s.items.map((i) => i.dealId)));
  for (const d of deals) assert.ok(allIds.has(d.dealId), `Missing ${d.dealId}`);
  assert.equal(allIds.size, 20);
  assert.equal(vm.summary.totalDeals, 20);
});

// ---------------------------------------------------------------------------
// 7. Deterministic ordering
// ---------------------------------------------------------------------------

test("identical input produces identical output", () => {
  const deals = [
    mkDeal({ dealId: "d-a", urgencyBucket: "urgent" }),
    mkDeal({ dealId: "d-b", urgencyBucket: "critical" }),
  ];
  const a = buildBankerCommandCenterFromDeals({ deals });
  const b = buildBankerCommandCenterFromDeals({ deals });
  assert.deepStrictEqual(a, b);
});

test("input ordering does not affect output", () => {
  const a = buildBankerCommandCenterFromDeals({
    deals: [mkDeal({ dealId: "d-a" }), mkDeal({ dealId: "d-b" })],
  });
  const b = buildBankerCommandCenterFromDeals({
    deals: [mkDeal({ dealId: "d-b" }), mkDeal({ dealId: "d-a" })],
  });
  assert.deepStrictEqual(a, b);
});

// ---------------------------------------------------------------------------
// 8. Priority band derivation
// ---------------------------------------------------------------------------

test("urgency=critical maps to immediate_attention", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [mkDeal({ dealId: "d-1", urgencyBucket: "critical" })],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.priorityBand, "immediate_attention");
});

test("blockingParty=borrower overrides non-critical urgency to waiting_on_borrower", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({
        dealId: "d-1",
        urgencyBucket: "urgent",
        blockingParty: "borrower",
      }),
    ],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.priorityBand, "waiting_on_borrower");
});

// ---------------------------------------------------------------------------
// 9. Counts derived from real fields only
// ---------------------------------------------------------------------------

test("requiredDocumentsRemaining and needsAttentionCount derive from real counts only", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({
        dealId: "d-1",
        borrowerOverdueCount: 3,
        reviewBacklogCount: 2,
      }),
    ],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.requiredDocumentsRemaining, 3);
  assert.equal(item?.needsAttentionCount, 2);
});

test("zero counts do not produce zero fields (omitted, not zero)", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [mkDeal({ dealId: "d-1", borrowerOverdueCount: 0, reviewBacklogCount: 0 })],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.requiredDocumentsRemaining, undefined);
  assert.equal(item?.needsAttentionCount, undefined);
});

// ---------------------------------------------------------------------------
// 10. Top blocker carries real reason description
// ---------------------------------------------------------------------------

test("topBlocker carries queueReasonDescription when present", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({
        dealId: "d-1",
        queueReasonDescription: "Borrower has 3 overdue uploads",
      }),
    ],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.topBlocker, "Borrower has 3 overdue uploads");
});

// ---------------------------------------------------------------------------
// 11. Next best action falls back via primaryActionLabel → queueReasonLabel
// ---------------------------------------------------------------------------

test("nextBestActionLabel prefers primaryActionLabel when set", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({
        dealId: "d-1",
        primaryActionLabel: "Send borrower reminder",
        queueReasonLabel: "Uploads waiting review",
      }),
    ],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.nextBestActionLabel, "Send borrower reminder");
});

test("nextBestActionLabel falls back to queueReasonLabel when no primaryActionLabel", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({
        dealId: "d-1",
        primaryActionLabel: null,
        queueReasonLabel: "Uploads waiting review",
      }),
    ],
  });
  const item = vm.sections.flatMap((s) => s.items)[0];
  assert.equal(item?.nextBestActionLabel, "Uploads waiting review");
});

// ---------------------------------------------------------------------------
// 12. No forbidden terms in adapter output
// ---------------------------------------------------------------------------

const FORBIDDEN = [
  "supabase",
  "classifier",
  "parser error",
  "extraction failed",
  "approval odds",
  "guaranteed",
  "approved",
  "pre-approved",
  "probability of approval",
  "lender acceptance probability",
  "risk score",
  "borrower qualifies",
  "loan will fund",
  "guaranteed funding",
  "fake sla",
  "simulated",
];

test("no forbidden terms in adapter output across scenarios", () => {
  const variants = [
    mkDeal({ dealId: "d-1" }),
    mkDeal({ dealId: "d-2", urgencyBucket: "critical" }),
    mkDeal({ dealId: "d-3", blockingParty: "borrower" }),
    mkDeal({ dealId: "d-4", queueReasonCode: "readiness_blocked" }),
  ];
  const vm = buildBankerCommandCenterFromDeals({ deals: variants });
  const text = [
    ...vm.sections.flatMap((s) => [s.label, ...s.items.flatMap((i) => [
      i.borrowerLabel,
      i.readinessLabel,
      i.waitingOnLabel,
      i.nextBestActionLabel,
      i.topBlocker ?? "",
      i.submissionReadinessLabel ?? "",
      i.trustReviewLabel ?? "",
    ])]),
  ]
    .join(" ")
    .toLowerCase();
  for (const term of FORBIDDEN) {
    assert.ok(!text.includes(term.toLowerCase()), `Forbidden term "${term}"`);
  }
});

// ---------------------------------------------------------------------------
// 13. No approval language
// ---------------------------------------------------------------------------

test("no approval/funding/guarantee phrases in adapter output", () => {
  const vm = buildBankerCommandCenterFromDeals({
    deals: [
      mkDeal({
        dealId: "d-1",
        primaryActionLabel: "Open deal workspace",
        queueReasonLabel: "Uploads waiting review",
        queueReasonDescription: "Borrower has uploaded items awaiting review",
      }),
    ],
  });
  const text = vm.sections
    .flatMap((s) => s.items.map((i) => [
      i.nextBestActionLabel,
      i.waitingOnLabel,
      i.topBlocker ?? "",
    ]))
    .flat()
    .join(" ")
    .toLowerCase();
  for (const phrase of [
    "you are approved",
    "borrower is approved",
    "loan will fund",
    "guaranteed funding",
    "pre-approved",
    "conditional approval",
    "credit decision",
  ]) {
    assert.ok(!text.includes(phrase), `Approval phrase "${phrase}"`);
  }
});
