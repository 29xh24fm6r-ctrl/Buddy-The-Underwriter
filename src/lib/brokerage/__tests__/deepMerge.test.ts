import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const mod = require("../borrowerConversation") as typeof import("../borrowerConversation");
const { deepMerge } = mod;

test("deepMerge: b's scalar values win over a's on key overlap", () => {
  const result = deepMerge({ legal_name: "Old Name", ein: "12-3456789" }, { legal_name: "New Name" });
  assert.deepEqual(result, { legal_name: "New Name", ein: "12-3456789" });
});

test("deepMerge: nested objects merge key-by-key instead of wholesale replacement", () => {
  const result = deepMerge(
    { business: { legal_name: "Acme", naics_code: "722513" } },
    { business: { legal_name: "Acme LLC" } },
  );
  assert.deepEqual(result, { business: { legal_name: "Acme LLC", naics_code: "722513" } });
});

test("deepMerge: null/undefined values in b never clobber a's existing value", () => {
  const result = deepMerge({ legal_name: "Acme LLC" }, { legal_name: null, ein: undefined });
  assert.deepEqual(result, { legal_name: "Acme LLC" });
});

test("deepMerge: this is the exact precedence used to merge voice (confirmed_facts) over text (extracted_facts) in seal-status", () => {
  // Regression lock for src/app/api/brokerage/deals/[dealId]/seal-status/route.ts's
  // deepMerge(extracted_facts, confirmed_facts) call — confirmed_facts (voice,
  // second arg / "b") must win on overlap, matching the "voice precedence"
  // reconciliation policy documented in supabase/migrations/20260424_borrower_voice.sql.
  const extractedFacts = { loan: { amount_requested: 25_000 }, business: { legal_name: "Acme LLC" } };
  const confirmedFacts = { loan: { amount_requested: 250_000 } };
  const merged = deepMerge(extractedFacts, confirmedFacts);
  assert.deepEqual(merged, {
    loan: { amount_requested: 250_000 },
    business: { legal_name: "Acme LLC" },
  });
});
