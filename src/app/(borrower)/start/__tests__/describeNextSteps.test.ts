import test from "node:test";
import assert from "node:assert/strict";
import { describeNextSteps } from "../StartConciergeClient";

test("returns null when nothing is left", () => {
  assert.equal(describeNextSteps([]), null);
});

test("singular phrasing for one field", () => {
  assert.equal(describeNextSteps(["borrower.email"]), "One thing left: your email.");
});

test("plain-language joins multiple fields with an Oxford-free 'and'", () => {
  assert.equal(
    describeNextSteps(["borrower.first_name", "borrower.email", "loan.amount_requested"]),
    "3 things left: your name, your email and how much you're financing.",
  );
});

test("falls back to the raw field key for anything unmapped", () => {
  assert.equal(describeNextSteps(["some.unmapped_field"]), "One thing left: some.unmapped_field.");
});
