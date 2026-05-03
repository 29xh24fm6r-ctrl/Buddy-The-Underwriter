import test from "node:test";
import assert from "node:assert/strict";
import {
  detectTridentIntent,
  TRIDENT_PREVIEW_RESPONSE,
} from "../conciergeIntent";

test("returns matched=false for empty input", () => {
  assert.equal(detectTridentIntent("").matched, false);
  assert.equal(
    detectTridentIntent(undefined as unknown as string).matched,
    false,
  );
});

test("matches business plan phrasings", () => {
  for (const text of [
    "Can you give me my business plan?",
    "I need a Business Plan for the SBA",
    "send the business-plan",
  ]) {
    const r = detectTridentIntent(text);
    assert.equal(r.matched, true, text);
    if (r.matched) assert.equal(r.intent, "business_plan");
  }
});

test("matches feasibility phrasings", () => {
  for (const text of [
    "I want a feasibility study",
    "feasibility please",
    "feasibility studies for franchise",
  ]) {
    const r = detectTridentIntent(text);
    assert.equal(r.matched, true, text);
    if (r.matched) assert.equal(r.intent, "feasibility");
  }
});

test("matches projections phrasings", () => {
  for (const text of [
    "share the projections",
    "I need 3-year projection",
    "send my proforma",
    "pro forma please",
  ]) {
    const r = detectTridentIntent(text);
    assert.equal(r.matched, true, text);
    if (r.matched) assert.equal(r.intent, "projections");
  }
});

test("matches lender-ready package phrasings", () => {
  for (const text of [
    "give me a lender-ready package",
    "lender ready bundle",
    "preview package please",
    "trident package",
  ]) {
    const r = detectTridentIntent(text);
    assert.equal(r.matched, true, text);
    if (r.matched)
      assert.ok(
        r.intent === "lender_ready_package" ||
          r.intent === "business_plan" ||
          r.intent === "feasibility" ||
          r.intent === "projections",
      );
  }
});

test("does NOT match unrelated chatter", () => {
  for (const text of [
    "what is my loan amount",
    "I want to buy a franchise",
    "tell me about SBA 7a",
    "hello",
    "I need a SCORE",
  ]) {
    assert.equal(detectTridentIntent(text).matched, false, text);
  }
});

test("matches generic deliverable phrasings the borrower will actually use", () => {
  // These were the P0 misses observed in /start: borrower said the
  // canonical phrasings below and got LLM section-by-section generation
  // instead of the preview flow.
  for (const text of [
    "show me the business plan",
    "can I see the feasibility study",
    "what does the plan look like",
    "give me the documents",
    "show me what we built",
    "can I see what you built",
    "I want to see the package",
    "where is my plan",
    "what did you build",
    "send me the deliverables",
    "preview the bundle",
    "ready to see the docs",
  ]) {
    const r = detectTridentIntent(text);
    assert.equal(r.matched, true, text);
  }
});

test("does NOT match borrower describing their OWN uploads (no request cue)", () => {
  for (const text of [
    "I have the documents ready to upload",
    "I'll bring the documents next week",
    "I scanned the documents",
    "the documents are at home",
  ]) {
    assert.equal(detectTridentIntent(text).matched, false, text);
  }
});

test("canonical response message is exact", () => {
  assert.equal(
    TRIDENT_PREVIEW_RESPONSE,
    "I can generate a preview package inside Buddy. The full package unlocks when you pick a lender.",
  );
});

test("response NEVER mentions copy/paste, templates, or external tools", () => {
  const banned = [
    /copy[\s/-]*paste/i,
    /template/i,
    /can'?t generate/i,
    /docusign/i,
    /word doc/i,
    /google docs/i,
  ];
  for (const re of banned) {
    assert.equal(
      re.test(TRIDENT_PREVIEW_RESPONSE),
      false,
      `must not contain ${re}`,
    );
  }
});
