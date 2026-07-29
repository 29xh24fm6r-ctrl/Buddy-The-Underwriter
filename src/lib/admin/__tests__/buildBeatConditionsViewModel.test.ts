/**
 * SPEC-M2 BEAT-METRICS-1 — beatConditions field on
 * buildBrokerageOwnerCommandCenterViewModel. Kept as a separate focused
 * file rather than extending buildBrokerageOwnerCommandCenterViewModel.test.ts
 * (already large) — self-contained input, no shared fixtures needed since
 * `deals: []` plus optional `beatMetrics` is a complete valid input.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBrokerageOwnerCommandCenterViewModel,
  type BrokerageOwnerCommandCenterInput,
} from "@/lib/admin/buildBrokerageOwnerCommandCenterViewModel";

function baseInput(
  overrides: Partial<BrokerageOwnerCommandCenterInput> = {},
): BrokerageOwnerCommandCenterInput {
  return { deals: [], ...overrides };
}

test("beatConditions is omitted entirely when no beatMetrics input is supplied", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(baseInput());
  assert.equal("beatConditions" in vm, false);
});

test("beatConditions is omitted when beatMetrics is explicitly null", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(baseInput({ beatMetrics: null }));
  assert.equal("beatConditions" in vm, false);
});

test("beatConditions maps every field through from beatMetrics input", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(
    baseInput({
      beatMetrics: {
        avgTtfaMinutes: 12.4,
        ttfaDealCount: 7,
        formlessStartRatePct: 0,
        formlessStartDealCount: 40,
        dealsWithRepeatAsks: 2,
        avgDocRequestRounds: 1.5,
        avgLenderFollowupCount: 0.3,
      },
    }),
  );
  assert.deepEqual(vm.beatConditions, {
    avgTtfaMinutes: 12.4,
    ttfaDealCount: 7,
    formlessStartRatePct: 0,
    formlessStartDealCount: 40,
    dealsWithRepeatAsks: 2,
    avgDocRequestRounds: 1.5,
    avgLenderFollowupCount: 0.3,
  });
});

test("null metric values pass through as null (honest 'no data yet'), not coerced to 0", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(
    baseInput({
      beatMetrics: {
        avgTtfaMinutes: null,
        ttfaDealCount: 0,
        formlessStartRatePct: null,
        formlessStartDealCount: 0,
        dealsWithRepeatAsks: 0,
        avgDocRequestRounds: null,
        avgLenderFollowupCount: null,
      },
    }),
  );
  assert.equal(vm.beatConditions?.avgTtfaMinutes, null);
  assert.equal(vm.beatConditions?.formlessStartRatePct, null);
  assert.equal(vm.beatConditions?.avgDocRequestRounds, null);
  assert.equal(vm.beatConditions?.avgLenderFollowupCount, null);
});

test("missing sample-size fields default to 0, not null/undefined", () => {
  const vm = buildBrokerageOwnerCommandCenterViewModel(
    baseInput({
      beatMetrics: {
        avgTtfaMinutes: null,
        ttfaDealCount: null,
        formlessStartRatePct: null,
        formlessStartDealCount: null,
        dealsWithRepeatAsks: null,
        avgDocRequestRounds: null,
        avgLenderFollowupCount: null,
      },
    }),
  );
  assert.equal(vm.beatConditions?.ttfaDealCount, 0);
  assert.equal(vm.beatConditions?.formlessStartDealCount, 0);
  assert.equal(vm.beatConditions?.dealsWithRepeatAsks, 0);
});
