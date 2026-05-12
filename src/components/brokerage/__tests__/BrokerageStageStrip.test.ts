import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Pull the pure helper out without rendering React. The component module
// includes "use client" + a JSX function, but the helpers we exercise here
// are pure JS.
const mod = require("../BrokerageStageStrip") as {
  deriveBrokerageStage: (args: {
    hasDealId: boolean;
    progressPct: number;
    sealed?: boolean;
    listed?: boolean;
    claimWindowClosed?: boolean;
  }) => string;
  __test_BROKERAGE_STAGES: ReadonlyArray<{ key: string; label: string }>;
};

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
