import test from "node:test";
import assert from "node:assert/strict";
import {
  detectTridentIntent,
  isReadOnlyConciergeMessage,
  detectAssumptionsConfirmIntent,
  TRIDENT_PREVIEW_RESPONSE,
  ASSUMPTIONS_CONFIRMED_RESPONSE,
  ASSUMPTIONS_CONFIRM_BLOCKED_PREFIX,
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
    "give me the documents",
    "show me what we built",
    "can I see what you built",
    "I want to see the package",
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
    "I can prepare your loan package inside Buddy. Your business plan, feasibility study and projections unlock after a bank claims your deal and you select that bank. You can keep completing your application in the meantime.",
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

// ── Assumptions confirmation intent ──────────────────────────────────────

test("assumptions confirm: returns matched=false for empty input", () => {
  assert.equal(detectAssumptionsConfirmIntent("").matched, false);
  assert.equal(
    detectAssumptionsConfirmIntent(undefined as unknown as string).matched,
    false,
  );
});

test("assumptions confirm: matches explicit confirm verbs", () => {
  for (const text of [
    "I confirm",
    "i confirm these numbers",
    "Confirm the assumptions please",
    "please confirm",
    "confirmed",
    "confirm",
  ]) {
    assert.equal(
      detectAssumptionsConfirmIntent(text).matched,
      true,
      text,
    );
  }
});

test("assumptions confirm: matches approval phrasings", () => {
  for (const text of [
    "looks good",
    "Looks correct",
    "looks right to me",
    "looks great",
    "lgtm",
    "approved",
    "approve",
    "that's right",
    "that's correct",
    "those are accurate",
    "everything looks right",
    "all good",
    "all set",
  ]) {
    assert.equal(
      detectAssumptionsConfirmIntent(text).matched,
      true,
      text,
    );
  }
});

test("assumptions confirm: matches lock-in / proceed phrasings", () => {
  for (const text of [
    "lock it in",
    "lock in",
    "lock these in",
    "submit it",
    "submit the assumptions",
    "proceed",
    "go ahead",
    "send it",
    "yes, confirm",
    "yes proceed",
    "yeah that's correct",
    "yep, lock in",
  ]) {
    assert.equal(
      detectAssumptionsConfirmIntent(text).matched,
      true,
      text,
    );
  }
});

test("assumptions confirm: does NOT match ambiguous bare yes/ok", () => {
  for (const text of [
    "yes",
    "yeah",
    "yep",
    "ok",
    "okay",
    "sure",
    "thanks",
    "got it",
    "what about feasibility",
    "tell me more",
    "I'm not sure",
  ]) {
    assert.equal(
      detectAssumptionsConfirmIntent(text).matched,
      false,
      text,
    );
  }
});

test("assumptions confirm: does NOT match 'confirm lender' (different intent)", () => {
  // The borrower picking a lender is a different flow — must not be
  // captured as an assumptions confirmation.
  assert.equal(
    detectAssumptionsConfirmIntent("confirm lender pick").matched,
    false,
  );
});

test("assumptions confirm: returns matchedTerm for telemetry", () => {
  const r = detectAssumptionsConfirmIntent("Looks good — let's proceed");
  assert.equal(r.matched, true);
  if (r.matched) {
    assert.ok(typeof r.matchedTerm === "string" && r.matchedTerm.length > 0);
  }
});

test("assumptions confirm: response constants are non-empty strings", () => {
  assert.ok(ASSUMPTIONS_CONFIRMED_RESPONSE.length > 0);
  assert.ok(ASSUMPTIONS_CONFIRM_BLOCKED_PREFIX.length > 0);
  // The blocked prefix should not promise success.
  assert.equal(/locked\s*in/i.test(ASSUMPTIONS_CONFIRM_BLOCKED_PREFIX), false);
});

 test("informational questions and non-consent never authorize financial actions", () => {
  for (const text of [
    "For this synthetic QA application, explain the difference between a prepared lender package and being approved or submitted. Do not change any saved answers or submit anything.",
    "Am I approved?", "What does confirmed mean?", "Explain my business plan",
    "Do not generate my projections", "Don't confirm anything", "Please explain before you proceed",
    "What does the plan look like?", "Where is my plan?", "What did you build?",
    "How do I confirm assumptions?", "Never submit it", "Is everything correct?",
  ]) {
    assert.equal(detectTridentIntent(text).matched, false, text);
    assert.equal(detectAssumptionsConfirmIntent(text).matched, false, text);
  }
});

test("factual negative answers remain available to legacy intake extraction", () => {
  assert.equal(isReadOnlyConciergeMessage("I don't have another business"), false);
  assert.equal(isReadOnlyConciergeMessage("I do not owe any taxes"), false);
  assert.equal(detectAssumptionsConfirmIntent("I have not approved it").matched, false);
});
