import test from "node:test";
import assert from "node:assert/strict";
import { buildGuidedSnapshot, parseAnswer } from "../questions";
test("zero, explicit no, dates and invalid values stay distinct", () => {
  assert.equal(parseAnswer("0", "number"), 0);
  assert.equal(parseAnswer(false, "boolean"), false);
  assert.equal(parseAnswer("", "number"), null);
  assert.throws(() => parseAnswer("maybe", "boolean"));
  assert.throws(() => parseAnswer("NaN", "number"));
  assert.throws(() => parseAnswer("$", "number"));
  assert.throws(() => parseAnswer("2026-02-30", "date"));
});
test("separate owners produce separate questions; unconfirmed character answers do not count as saved", () => {
  const rows = {
    ownership_entities: [
      {
        id: "one",
        display_name: "One",
        entity_type: "individual",
        ownership_pct: 50,
        legal_action_pending: false,
      },
      {
        id: "two",
        display_name: "Two",
        entity_type: "individual",
        ownership_pct: 50,
      },
    ],
    borrowers: [{ legal_name: "Example" }],
    deal_loan_requests: [{ product_type: "SBA_7A" }],
  };
  const s = buildGuidedSnapshot({ rows, facts: {}, revision: null });
  assert.ok(s.questions.some((q) => q.id === "owner.full_name:one"));
  assert.ok(s.questions.some((q) => q.id === "owner.full_name:two"));
  assert.ok(
    s.questions.some((q) => q.id === "business.contact_name" && q.required),
  );
  assert.ok(
    s.questions.some((q) => q.id === "business.contact_email" && q.required),
  );
  assert.equal(
    s.questions.find((q) => q.id === "owner.legal_action_pending:one")?.state,
    "needs_confirmation",
  );
  assert.equal(new Set(s.questions.map((q) => q.id)).size, s.questions.length);
  assert.equal(s.questions.filter((q) => /^[A-Z]\d\d$/.test(q.id)).length, 165);
});
