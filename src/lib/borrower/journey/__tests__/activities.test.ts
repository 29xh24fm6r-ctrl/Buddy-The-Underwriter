import test from "node:test";
import assert from "node:assert/strict";
import { buildGuidedSnapshot } from "../../guidedPackage/questions";
import { activityChoices, activityCopy } from "../activities";

const question = (id: string) => {
  const found = buildGuidedSnapshot({ rows: {}, facts: {}, revision: null })
    .questions.find((candidate) => candidate.id === id);
  assert.ok(found, `${id} should exist`);
  return found;
};

test("timeline is a recognition task with an uncertainty path", () => {
  const choices = activityChoices(question("A07"));
  assert.ok(choices);
  assert.ok(choices.some(([value]) => value.includes("3 to 6")));
  assert.ok(choices.some(([value]) => value.includes("Still exploring")));
  assert.match(activityCopy(question("A07")).hint, /rough target/i);
});

test("open narrative prompts receive concise guidance", () => {
  assert.match(activityCopy(question("D03")).hint ?? "", /short answer/i);
});
