import test from "node:test";
import assert from "node:assert/strict";
import { buildGuidedSnapshot, parseAnswer } from "../questions";
import { packageInterviewAnswers } from "../interviewContext";
test("size receipts has a numeric borrower control and preserves explicit zero in the package", () => {
  const facts = { package_answers: { B13: { value: 0 }, B14: { value: "Pre-opening, no receipts or affiliates; supporting schedule supplied." } } };
  const snapshot = buildGuidedSnapshot({ rows: {}, facts, revision: null });
  const receipts = snapshot.questions.find(q => q.id === "B13");
  assert.equal(receipts?.type, "currency");
  assert.equal(receipts?.state, "saved");
  assert.equal(receipts?.value, 0);
  assert.ok(packageInterviewAnswers(facts).some(a => a.answer === "0"));
});
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
  assert.equal(s.questions.filter((q) => /^[A-Z]\d\d$/.test(q.id)).length, 167);
});
