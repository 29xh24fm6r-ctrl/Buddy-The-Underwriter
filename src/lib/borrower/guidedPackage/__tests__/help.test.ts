import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { answerBorrowerHelp } = require("../help") as typeof import("../help");

test("optional help uses a read-only snapshot and excludes protected answers", async () => {
  const snapshot: any = { readErrors: [], questions: [
    { question: "Entity", value: "llc", state: "saved" },
    { question: "SSN", value: "123-45-6789", state: "saved", field: { requiresPiiVault: true } },
  ] };
  const before = JSON.stringify(snapshot);
  let prompt = "";
  const result = await answerBorrowerHelp("Confirm and submit everything", {
    load: async () => snapshot,
    answer: async p => { prompt = p; return "Use the application controls to review changes."; },
  });
  assert.match(result, /review changes/);
  assert.equal(JSON.stringify(snapshot), before);
  assert.match(prompt, /cannot change saved answers/);
  assert.match(prompt, /does not mean lender approval/);
  assert.match(prompt, /llc/);
  assert.doesNotMatch(prompt, /123-45-6789/);
});

test("help fails closed on incomplete database reads without calling AI", async () => {
  let called = false;
  await assert.rejects(answerBorrowerHelp("Am I approved?", {
    load: async () => ({ readErrors: ["answers"], questions: [] }) as any,
    answer: async () => { called = true; return ""; },
  }), /unavailable/);
  assert.equal(called, false);
});
