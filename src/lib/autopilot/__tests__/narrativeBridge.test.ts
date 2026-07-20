import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

let runNarrativeBridge: typeof import("../narrativeBridge").runNarrativeBridge;

before(async () => {
  mockServerOnly();
  ({ runNarrativeBridge } = await import("../narrativeBridge"));
});

const NARRATIVES = {
  executive_summary: "a",
  income_analysis: "b",
  repayment_analysis: "c",
  property_description: "d",
  borrower_background: "e",
  borrower_experience: "f",
  guarantor_strength: "g",
};

test("runNarrativeBridge: memo build fails -> ok false, narrative never invoked", async () => {
  let narrativeCalled = false;
  const result = await runNarrativeBridge("deal-1", "bank-1", {
    buildMemo: (async () => ({ ok: false, error: "no deal found" })) as any,
    assembleNarr: async () => {
      narrativeCalled = true;
      return { narratives: NARRATIVES };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.memo_built, false);
  assert.match(result.message, /Memo build failed/);
  assert.equal(narrativeCalled, false);
});

test("runNarrativeBridge: memo + narratives succeed -> ok true with section count", async () => {
  const result = await runNarrativeBridge("deal-1", "bank-1", {
    buildMemo: (async (args: any) => ({ ok: true, memo: { deal_id: args.dealId } })) as any,
    assembleNarr: async () => ({ narratives: NARRATIVES }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.memo_built, true);
  assert.equal(result.narrative_sections_generated, 7);
  assert.equal(result.narrative_ai_error, undefined);
});

test("runNarrativeBridge: memo succeeds but narrative AI falls back -> ok false with ai error surfaced", async () => {
  const result = await runNarrativeBridge("deal-1", "bank-1", {
    buildMemo: (async (args: any) => ({ ok: true, memo: { deal_id: args.dealId } })) as any,
    assembleNarr: async () => ({ narratives: NARRATIVES, aiError: "GEMINI_API_KEY not configured" }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.memo_built, true);
  assert.equal(result.narrative_ai_error, "GEMINI_API_KEY not configured");
  assert.match(result.message, /fell back/);
});
