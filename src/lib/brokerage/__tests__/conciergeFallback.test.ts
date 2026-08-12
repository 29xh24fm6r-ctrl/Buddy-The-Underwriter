import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { buildSafeFallbackReply, CONCIERGE_TURN_RESPONSE_SCHEMA } =
  require("../borrowerConversation") as typeof import("../borrowerConversation");
const {
  detectTridentIntent,
  detectAssumptionsConfirmIntent,
} = require("../trident/conciergeIntent") as typeof import("../trident/conciergeIntent");

/**
 * SPEC-CONCIERGE-EMPTY-MESSAGE-FIX-1 — regression coverage for the concierge
 * "need money" dead-end-fallback bug.
 *
 * This file does NOT stand up a live Gemini call or the full route (no
 * cookie/DB harness exists for this route — see gatewayFlagWiring.test.ts's
 * doc comment for why source-shape/pure-function tests are this codebase's
 * established convention here instead). What it verifies:
 *
 *  1. Vague and detailed financing phrases are NOT captured by either
 *     keyword short-circuit (Trident / assumptions-confirm) — proving they
 *     fall through to the general LLM path generically, with no brittle
 *     one-off phrase rule added for any of them.
 *  2. The existing Trident and assumptions-confirm intents still match,
 *     unchanged.
 *  3. buildSafeFallbackReply — the function that now runs in place of the
 *     old dead-end string whenever the model call fails, times out, or
 *     returns an empty/malformed "message" — always produces a real,
 *     forward-moving intake question, never the old dead-end copy, and
 *     never invents a borrower fact.
 *  4. CONCIERGE_TURN_RESPONSE_SCHEMA requires "message" but leaves
 *     "extracted_facts" unconstrained (the actual root-cause fix).
 *  5. Source tripwires confirming the schema is wired into both
 *     callConciergeTurnModel branches and the old dead-end string is gone.
 */

const OLD_DEAD_END_MESSAGE =
  "Sorry, I didn't quite catch that — could you tell me again what you're looking to finance?";

// ── 1. Vague / detailed financing phrases fall through generically ───────

const FINANCING_PHRASES = [
  "need money",
  "I need funding",
  "I want an SBA loan",
  "help me get financing",
  "I'm looking for a $500,000 SBA loan to buy a laundromat in Austin, TX",
];

test("vague and detailed financing phrases are NOT captured by the Trident short-circuit", () => {
  for (const text of FINANCING_PHRASES) {
    assert.equal(detectTridentIntent(text).matched, false, text);
  }
});

test("vague and detailed financing phrases are NOT captured by the assumptions-confirm short-circuit", () => {
  for (const text of FINANCING_PHRASES) {
    assert.equal(detectAssumptionsConfirmIntent(text).matched, false, text);
  }
});

// ── 2. Existing intents still work, unchanged ─────────────────────────────

test("REGRESSION: existing Trident/deliverable intent still matches", () => {
  const r = detectTridentIntent("show me the business plan");
  assert.equal(r.matched, true);
  if (r.matched) assert.equal(r.intent, "business_plan");
});

test("REGRESSION: existing assumptions-confirmation intent still matches", () => {
  assert.equal(detectAssumptionsConfirmIntent("looks good").matched, true);
  assert.equal(detectAssumptionsConfirmIntent("confirm").matched, true);
});

// ── 3. buildSafeFallbackReply — no dead end, no invented facts ───────────

test("buildSafeFallbackReply: empty facts asks for the borrower's name (bootstrap phase 1)", () => {
  const msg = buildSafeFallbackReply({});
  assert.match(msg, /name/i);
  assert.notEqual(msg, OLD_DEAD_END_MESSAGE);
});

test("buildSafeFallbackReply: name known, nothing else asks for email next (bootstrap ordering preserved)", () => {
  const msg = buildSafeFallbackReply({ borrower: { first_name: "Ana" } });
  assert.match(msg, /email/i);
});

test("buildSafeFallbackReply: bootstrap satisfied but a registry field open asks a real next question, not a dead end", () => {
  const facts = {
    borrower: { first_name: "Ana", email: "a@b.co" },
    business: { legal_name: "Acme LLC", is_franchise: false },
    loan: { amount_requested: 250000, use_of_proceeds: "equipment" },
  };
  const msg = buildSafeFallbackReply(facts);
  assert.notEqual(msg, OLD_DEAD_END_MESSAGE);
  assert.doesNotMatch(msg, /didn't quite catch|I don't understand/i);
  assert.ok(msg.length > 0);
});

test("buildSafeFallbackReply: everything essential known responds positively, not with a dead end", () => {
  const facts = {
    borrower: { first_name: "Ana", email: "a@b.co" },
    business: {
      legal_name: "Acme LLC",
      ein: "12-3456789",
      address_street: "1 Main St",
      address_city: "Springfield",
      address_state: "IL",
      address_zip: "62701",
      phone: "555-0100",
      entity_type: "llc",
      naics: "541511",
      employee_count: 5,
      year_founded: 2015,
      has_pending_sba_application: false,
      has_bankruptcy_history: false,
      has_pending_lawsuits: false,
      is_engaged_in_lobbying: false,
      is_franchise: false,
    },
    loan: { amount_requested: 250000, use_of_proceeds: "working capital" },
  };
  const msg = buildSafeFallbackReply(facts);
  assert.notEqual(msg, OLD_DEAD_END_MESSAGE);
  assert.match(msg, /good shape|anything else/i);
});

test("buildSafeFallbackReply: a registry field present in canonicallyAnswered is treated as satisfied (no repeat-ask)", () => {
  // Bootstrap-phase fields (name/email/business/loan amount/use of proceeds/
  // franchise) are checked directly against conversation facts, matching
  // the main prompt's own "priorities" ordering (see
  // buildCombinedConciergeTurnPromptJSON) — canonicallyAnswered only
  // applies once the registry phase is reached (computeMissingRegistryFields).
  const bootstrapSatisfied = {
    borrower: { first_name: "Ana", email: "a@b.co" },
    business: { legal_name: "Acme LLC", is_franchise: false },
    loan: { amount_requested: 250000, use_of_proceeds: "equipment" },
  };
  const withoutCanonical = buildSafeFallbackReply(bootstrapSatisfied);
  assert.notEqual(withoutCanonical, OLD_DEAD_END_MESSAGE);

  // Marking every possible registry field as canonically answered should
  // collapse the fallback to the "nothing left to ask" branch instead of
  // repeat-asking something already known from a prior session/document.
  const { BORROWER_FIELD_REGISTRY } = require("../../sba/forms/borrowerFieldRegistry") as typeof import("../../sba/forms/borrowerFieldRegistry");
  const allFactPaths = new Set(BORROWER_FIELD_REGISTRY.map((f) => f.factPath));
  const withCanonical = buildSafeFallbackReply(bootstrapSatisfied, allFactPaths);
  assert.match(withCanonical, /good shape|anything else/i);
});

test("buildSafeFallbackReply is deterministic (no randomness, nothing invented) for the same input", () => {
  const facts = { borrower: { first_name: "Ana", email: "a@b.co" } };
  assert.equal(buildSafeFallbackReply(facts), buildSafeFallbackReply(facts));
});

test("buildSafeFallbackReply never returns the old dead-end message for any fixture", () => {
  const fixtures: Record<string, unknown>[] = [
    {},
    { borrower: { first_name: "Ana" } },
    { borrower: { first_name: "Ana", email: "a@b.co" } },
    {
      borrower: { first_name: "Ana", email: "a@b.co" },
      business: { legal_name: "Acme LLC", is_franchise: false },
      loan: { amount_requested: 1, use_of_proceeds: "x" },
    },
  ];
  for (const facts of fixtures) {
    assert.notEqual(buildSafeFallbackReply(facts as Record<string, unknown>), OLD_DEAD_END_MESSAGE);
  }
});

// ── 4. Schema requires "message", leaves extracted_facts unconstrained ───

test("CONCIERGE_TURN_RESPONSE_SCHEMA requires message", () => {
  assert.ok(
    (CONCIERGE_TURN_RESPONSE_SCHEMA.required as readonly string[]).includes("message"),
  );
});

test("CONCIERGE_TURN_RESPONSE_SCHEMA does NOT constrain extracted_facts's internal shape (registry stays open-ended)", () => {
  const factsSchema = CONCIERGE_TURN_RESPONSE_SCHEMA.properties.extracted_facts as Record<
    string,
    unknown
  >;
  assert.equal(factsSchema.type, "object");
  assert.equal("properties" in factsSchema, false);
  assert.equal("required" in factsSchema, false);
});

test("CONCIERGE_TURN_RESPONSE_SCHEMA does NOT require extracted_facts or next_question (only message)", () => {
  const required = CONCIERGE_TURN_RESPONSE_SCHEMA.required as readonly string[];
  assert.equal(required.length, 1);
  assert.equal(required[0], "message");
});

// ── 5. Source tripwires (route.ts wiring) ─────────────────────────────────

function readRouteSrc(): string {
  return readFileSync(
    resolve(process.cwd(), "src/app/api/brokerage/concierge/route.ts"),
    "utf8",
  );
}

test("TRIPWIRE: the old dead-end fallback string no longer appears anywhere in route.ts", () => {
  const src = readRouteSrc();
  assert.doesNotMatch(src, /didn't quite catch/);
});

test("TRIPWIRE: the empty-message branch calls buildSafeFallbackReply with existingFacts and canonicallyAnswered", () => {
  const src = readRouteSrc();
  assert.match(
    src,
    /messageText = buildSafeFallbackReply\(existingFacts, canonicallyAnswered\)/,
  );
});

test("TRIPWIRE: both callConciergeTurnModel branches pass CONCIERGE_TURN_RESPONSE_SCHEMA", () => {
  const src = readRouteSrc();
  const fnIdx = src.indexOf("async function callConciergeTurnModel");
  assert.ok(fnIdx > -1);
  const fnBody = src.slice(fnIdx);
  const matches = fnBody.match(/responseSchema:\s*CONCIERGE_TURN_RESPONSE_SCHEMA/g) ?? [];
  assert.equal(matches.length, 2, "both the gateway branch and the legacy callGeminiJSON branch must pass the schema");
});

test("TRIPWIRE: Sentry alerting on the fallback path is preserved", () => {
  const src = readRouteSrc();
  assert.match(src, /Sentry\.captureMessage\("concierge_fallback_triggered"/);
});
