import test from "node:test";
import assert from "node:assert/strict";
import { FACTORY_ACTIVITIES, QUESTION_TREATMENTS, canGroupQuestion } from "../factoryActivities";
import { PACKAGE_QUESTIONS } from "../../guidedPackage/packageQuestions";
import { buildGuidedSnapshot } from "../../guidedPackage/questions";
import { recommendedQuestions } from "../presentation";
import { saveActivityAnswers, type ActivityDrafts } from "../saveActivity";

test("all 165 original questions have exactly one of 24 activity destinations", () => {
  const ids = FACTORY_ACTIVITIES.flatMap(a => [...a.questionIds]);
  assert.equal(FACTORY_ACTIVITIES.length, 24);
  assert.equal(ids.length, 165);
  assert.equal(new Set(ids).size, 165);
  assert.deepEqual([...ids].sort(), PACKAGE_QUESTIONS.map(q => q.id).sort());
  assert.equal(Object.keys(QUESTION_TREATMENTS).length, 165);
});
test("7 Brew franchise intent exposes franchise follow-ups without assuming an acquisition", () => {
  const snapshot = buildGuidedSnapshot({ rows: {}, facts: { package_answers: {
    A01: { value: "I want to purchase a 7 Brew coffee franchise" }, A11: { value: "startup" },
  } }, revision: null });
  const questions = recommendedQuestions(snapshot, "plan");
  assert.ok(questions.some(q => q.id === "K02"));
  assert.ok(!questions.some(q => q.id === "I01"));
  assert.equal(snapshot.questions.find(q => q.id === "K02")?.state, "unanswered");
  assert.ok(!questions.some(q => q.id === "A02"));
});
test("protected and explicit confirmations cannot join bulk activities", () => {
  const snapshot = buildGuidedSnapshot({ rows: { ownership_entities: [{ id: "o", name: "Owner", ownership_pct: 100 }] }, facts: {}, revision: null });
  for (const q of snapshot.questions.filter(q => q.field?.requiresPiiVault || q.field?.requiresExplicitConfirmation)) {
    assert.equal(canGroupQuestion(q), false);
  }
  assert.equal(canGroupQuestion(snapshot.questions.find(q => q.id === "loan.use_of_proceeds")!), false);
});
test("partial activity save preserves unsaved drafts and advances only after all responses validate", async () => {
  const snapshot = buildGuidedSnapshot({ rows: {}, facts: {}, revision: null });
  const questions = snapshot.questions.filter(q => ["A01", "A07"].includes(q.id));
  const drafts: ActivityDrafts = Object.fromEntries(questions.map(q => [q.id, { value: "Draft", baseline: null, source: "text" }]));
  let writes = 0, saved = 0;
  const request = (async () => {
    writes++;
    return writes === 1 ? Response.json({ ok: true, dealId: "d", snapshot })
      : Response.json({ ok: false, error: "This answer changed" }, { status: 409 });
  }) as typeof fetch;
  await assert.rejects(saveActivityAnswers({ questions, snapshot, drafts, dealId: "d", request, onSaved: () => saved++ }), /changed/);
  assert.equal(saved, 1);
  assert.equal(drafts[questions[0].id], undefined);
  assert.equal(drafts[questions[1].id].value, "Draft");
});
test("wrong-deal success cannot erase a draft", async () => {
  const snapshot = buildGuidedSnapshot({ rows: {}, facts: {}, revision: null });
  const questions = snapshot.questions.filter(q => q.id === "A01");
  const drafts: ActivityDrafts = { A01: { value: "My idea", baseline: null, source: "text" } };
  await assert.rejects(saveActivityAnswers({ questions, snapshot, drafts, dealId: "d",
    request: (async () => Response.json({ ok: true, dealId: "other", snapshot })) as typeof fetch, onSaved: () => assert.fail("must not update") }));
  assert.equal(drafts.A01.value, "My idea");
});
