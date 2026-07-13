import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Pull the pure helper out without rendering React. The component module
// includes "use client" + a JSX function, but the helpers we exercise here
// are pure JS.
type JourneyStatusInput = {
  hasDealId: boolean;
  progressPct: number;
  documentsUploadedCount: number;
  sealed: boolean;
  listingStatus: string | null;
  matchedLenderCount: number;
  claimsCount: number;
};

type JourneyChecklistStage = {
  key: string;
  label: string;
  state: "done" | "current" | "upcoming";
  items: Array<{ key: string; label: string; state: "done" | "current" | "upcoming" }>;
};

const mod = require("../BrokerageStageStrip") as {
  deriveBrokerageStage: (args: {
    hasDealId: boolean;
    progressPct: number;
    sealed?: boolean;
    listed?: boolean;
    claimWindowClosed?: boolean;
  }) => string;
  deriveJourneyChecklist: (input: JourneyStatusInput) => JourneyChecklistStage[];
  __test_BROKERAGE_STAGES: ReadonlyArray<{ key: string; label: string }>;
};

function baseInput(overrides: Partial<JourneyStatusInput> = {}): JourneyStatusInput {
  return {
    hasDealId: false,
    progressPct: 0,
    documentsUploadedCount: 0,
    sealed: false,
    listingStatus: null,
    matchedLenderCount: 0,
    claimsCount: 0,
    ...overrides,
  };
}

test("canonical stage list is exactly the spec's five stages", () => {
  assert.deepEqual(
    mod.__test_BROKERAGE_STAGES.map((s) => s.key),
    ["tell", "upload", "prepare", "review", "pick"],
  );
});

test("deriveBrokerageStage: pre-deal returns tell", () => {
  assert.equal(
    mod.deriveBrokerageStage({ hasDealId: false, progressPct: 0 }),
    "tell",
  );
});

test("deriveBrokerageStage: deal + <60% returns tell", () => {
  assert.equal(
    mod.deriveBrokerageStage({ hasDealId: true, progressPct: 40 }),
    "tell",
  );
});

test("deriveBrokerageStage: deal + >=60% returns upload", () => {
  assert.equal(
    mod.deriveBrokerageStage({ hasDealId: true, progressPct: 60 }),
    "upload",
  );
});

test("deriveBrokerageStage: sealed returns prepare", () => {
  assert.equal(
    mod.deriveBrokerageStage({
      hasDealId: true,
      progressPct: 100,
      sealed: true,
    }),
    "prepare",
  );
});

test("deriveBrokerageStage: listed returns review (overrides sealed)", () => {
  assert.equal(
    mod.deriveBrokerageStage({
      hasDealId: true,
      progressPct: 100,
      sealed: true,
      listed: true,
    }),
    "review",
  );
});

test("deriveBrokerageStage: claimWindowClosed returns pick (terminal)", () => {
  assert.equal(
    mod.deriveBrokerageStage({
      hasDealId: true,
      progressPct: 100,
      sealed: true,
      listed: true,
      claimWindowClosed: true,
    }),
    "pick",
  );
});

// ─── deriveJourneyChecklist: stage-level state ──────────────────────────

test("checklist: fresh borrower — only 'tell' stage is current, everything else upcoming", () => {
  const stages = mod.deriveJourneyChecklist(baseInput());
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  assert.equal(byKey.tell.state, "current");
  assert.equal(byKey.upload.state, "upcoming");
  assert.equal(byKey.prepare.state, "upcoming");
  assert.equal(byKey.review.state, "upcoming");
  assert.equal(byKey.pick.state, "upcoming");
});

test("checklist: progress >= 60 — 'tell' flips to done, 'upload' becomes current", () => {
  const stages = mod.deriveJourneyChecklist(baseInput({ hasDealId: true, progressPct: 60 }));
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  assert.equal(byKey.tell.state, "done");
  assert.equal(byKey.upload.state, "current");
});

test("checklist: sealed — 'prepare' is current, earlier stages done", () => {
  const stages = mod.deriveJourneyChecklist(
    baseInput({ hasDealId: true, progressPct: 100, sealed: true }),
  );
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  assert.equal(byKey.tell.state, "done");
  assert.equal(byKey.upload.state, "done");
  assert.equal(byKey.prepare.state, "current");
  assert.equal(byKey.review.state, "upcoming");
});

test("checklist: listingStatus 'claiming' — 'review' is current, 'prepare' done", () => {
  const stages = mod.deriveJourneyChecklist(
    baseInput({ hasDealId: true, progressPct: 100, sealed: true, listingStatus: "claiming" }),
  );
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  assert.equal(byKey.prepare.state, "done");
  assert.equal(byKey.review.state, "current");
  assert.equal(byKey.pick.state, "upcoming");
});

test("checklist: listingStatus 'awaiting_borrower_pick' — 'pick' is current, 'review' done", () => {
  const stages = mod.deriveJourneyChecklist(
    baseInput({
      hasDealId: true,
      progressPct: 100,
      sealed: true,
      listingStatus: "awaiting_borrower_pick",
      claimsCount: 2,
    }),
  );
  const byKey = Object.fromEntries(stages.map((s) => [s.key, s]));
  assert.equal(byKey.review.state, "done");
  assert.equal(byKey.pick.state, "current");
  const pickItem = byKey.pick.items.find((i) => i.key === "pick")!;
  assert.match(pickItem.label, /2 lenders ready/i);
});

test("checklist: listingStatus 'picked' — every stage done, nothing current or upcoming", () => {
  const stages = mod.deriveJourneyChecklist(
    baseInput({
      hasDealId: true,
      progressPct: 100,
      sealed: true,
      listingStatus: "picked",
      documentsUploadedCount: 3,
    }),
  );
  assert.ok(stages.every((s) => s.state === "done"), "expected every stage done once picked");
  assert.ok(
    stages.every((s) => s.items.every((i) => i.state === "done")),
    "expected every sub-item done once picked",
  );
});

// ─── deriveJourneyChecklist: sub-item detail (the actual ask) ──────────

test("checklist: 'tell' stage sub-items reflect started + details-in-progress separately", () => {
  const stages = mod.deriveJourneyChecklist(baseInput({ hasDealId: true, progressPct: 30 }));
  const tell = stages.find((s) => s.key === "tell")!;
  const started = tell.items.find((i) => i.key === "started")!;
  const details = tell.items.find((i) => i.key === "details")!;
  assert.equal(started.state, "done");
  assert.equal(details.state, "current");
  assert.match(details.label, /30% complete/);
});

test("checklist: past stages never show a mix of done/current sub-items", () => {
  // Regression guard for the itemState() clamp — once a stage is behind
  // the active stage, ALL its sub-items must read "done", never a
  // half-finished-looking item, even if the raw granular computation
  // would have said otherwise.
  const stages = mod.deriveJourneyChecklist(
    baseInput({ hasDealId: true, progressPct: 60, documentsUploadedCount: 0, sealed: true }),
  );
  const upload = stages.find((s) => s.key === "upload")!;
  assert.equal(upload.state, "done");
  assert.ok(
    upload.items.every((i) => i.state === "done"),
    "expected upload stage's sub-items to all read done once the borrower has moved past it, even with 0 documents uploaded",
  );
});

test("checklist: future stages' sub-items are always upcoming, never current", () => {
  const stages = mod.deriveJourneyChecklist(baseInput({ hasDealId: true, progressPct: 100 }));
  const prepare = stages.find((s) => s.key === "prepare")!;
  assert.equal(prepare.state, "upcoming");
  assert.ok(prepare.items.every((i) => i.state === "upcoming"));
});

test("checklist: document count surfaces in the upload stage label", () => {
  const stages = mod.deriveJourneyChecklist(
    baseInput({ hasDealId: true, progressPct: 60, documentsUploadedCount: 4 }),
  );
  const upload = stages.find((s) => s.key === "upload")!;
  const docs = upload.items.find((i) => i.key === "docs")!;
  assert.equal(docs.state, "done");
  assert.match(docs.label, /4 documents uploaded/);
});
