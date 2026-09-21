import test from "node:test";
import assert from "node:assert/strict";
import { buildGuidedSnapshot } from "../questions";
import { packageCompletionItems, borrowerPackageFailure } from "../completion";

test("1919 title and agent answer remain required even after every other answer is saved", () => {
  const snapshot = buildGuidedSnapshot({ rows: {
    ownership_entities: [{ id: "one", entity_type: "individual", display_name: "First owner" }, { id: "two", entity_type: "individual", display_name: "Second owner", title: "President" }],
    deal_loan_requests: [{ sba_program: "7A", agent_used: false }],
  }, facts: {}, revision: null });
  assert.equal(snapshot.questions.find(q => q.id === "owner.title:one")?.required, true);
  assert.equal(snapshot.questions.find(q => q.id === "owner.title:two")?.state, "saved");
  assert.equal(snapshot.questions.find(q => q.id === "loan.agent_used")?.required, true);
  assert.equal(snapshot.questions.find(q => q.id === "loan.agent_used")?.state, "saved");
  snapshot.questions = snapshot.questions.filter(q => q.id.startsWith("owner.title") || q.id === "loan.agent_used");
  snapshot.form722 = { posterAvailable: true, acknowledged: false };
  assert.deepEqual(packageCompletionItems(snapshot).map(i => i.id), ["owner.title:one", "form722"]);
  assert.match(packageCompletionItems(snapshot)[0].label, /First owner/);
  snapshot.questions.find(q => q.id === "owner.title:one")!.state = "saved";
  snapshot.form722.acknowledged = true;
  assert.deepEqual(packageCompletionItems(snapshot), []);
});

test("missing poster state fails closed and never invents consent", () => {
  assert.equal(packageCompletionItems({questions: []})[0].id, "form722");
});

test("form errors expose instructions without raw owner identifiers or renderer details", () => {
  const message = borrowerPackageFailure('SBA_1919 position secret-owner-id; SBA_159 agent_used; SBA_722 not_acknowledged');
  assert.match(message, /title or role/);
  assert.match(message, /agent or packager/);
  assert.match(message, /acknowledge receipt/);
  assert.doesNotMatch(message, /secret-owner-id|not_acknowledged/);
  assert.doesNotMatch(borrowerPackageFailure("secret internal error"), /secret internal error/);
});

test("paid-agent answers require real fee disclosure evidence and never default to not applicable", () => {
  const snapshot = buildGuidedSnapshot({rows:{deal_loan_requests:[{agent_used:true}]},facts:{},revision:null});
  snapshot.questions = snapshot.questions.filter(q=>q.id === "loan.agent_used");
  snapshot.form722 = {posterAvailable:true,acknowledged:true};
  assert.deepEqual(packageCompletionItems(snapshot).map(i=>i.id),["form159"]);
  snapshot.form159 = {complete:true};
  assert.deepEqual(packageCompletionItems(snapshot),[]);
});
