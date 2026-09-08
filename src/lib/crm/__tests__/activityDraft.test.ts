import test from "node:test";
import assert from "node:assert/strict";
import { activityPayload, saveActivityDraft, hasLenderWorkspace, type ActivityDraft } from "../activityDraft";
const draft: ActivityDraft = { kind: "note", title: "  Called Dana  ", body: "  Discussed referral  ", due: "" };

test("person and lead activity capture writes exactly one canonical target", async () => {
  for (const kind of ["organization", "person", "lead"] as const) {
    const request: typeof fetch = async (_url, init) => {
      const payload=JSON.parse(String(init?.body));
      const keys=["organizationId","personId","leadId","dealId"].filter(key=>key in payload);
      assert.deepEqual(keys,[`${kind}Id`]);
      assert.equal(payload[`${kind}Id`],"record");
      return Response.json({ok:true,activity:{id:"saved"}});
    };
    assert.equal(await saveActivityDraft("record",draft,request,kind),"saved");
  }
});

test("activity writes one canonical organization target and trims text", () => {
  assert.deepEqual(activityPayload("org-1", draft), { organizationId: "org-1", kind: "note", title: "Called Dana", properties: { body: "Discussed referral" } });
});
test("tasks require valid dates and store an ISO instant", () => {
  assert.throws(() => activityPayload("org", { ...draft, kind: "task" }), /valid follow-up/);
  assert.throws(() => activityPayload("org", { ...draft, kind: "task", due: "invalid" }), /valid follow-up/);
  assert.equal(activityPayload("org", { ...draft, kind: "task", due: "2026-09-03T14:30:00-04:00" }).dueAt, "2026-09-03T18:30:00.000Z");
});
test("blank targets and descriptions cannot be submitted", () => {
  assert.throws(() => activityPayload(" ", draft), /Choose a relationship/);
  assert.throws(() => activityPayload("org", { ...draft, title: " " }), /description/);
});
test("call and meeting logs record channels without stale task dates", () => {
  for (const kind of ["call", "meeting"] as const) {
    const payload = activityPayload("org", { ...draft, kind, due: "2026-09-03T14:00" });
    assert.equal(payload.channel, kind);
    assert.equal(payload.dueAt, undefined);
    assert.equal("deliveryState" in payload, false);
  }
});
test("referral records stay focused but existing lending capability is preserved", () => {
  assert.equal(hasLenderWorkspace("referral_source", null, 0), false);
  assert.equal(hasLenderWorkspace("lender", null, 0), true);
  assert.equal(hasLenderWorkspace("referral_source", { id: "profile" }, 0), true);
  assert.equal(hasLenderWorkspace("other", null, 2), true);
});
test("save uses the existing endpoint once and requires a confirmed activity id", async () => {
  let calls = 0;
  const request: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "/api/admin/brokerage/crm/activities");
    assert.equal(init?.method, "POST");
    assert.equal(JSON.parse(String(init?.body)).organizationId, "org");
    return Response.json({ ok: true, activity: { id: "saved" } });
  };
  assert.equal(await saveActivityDraft("org", draft, request), "saved");
  assert.equal(calls, 1);
});
test("failed, malformed and unconfirmed saves do not retry or mutate drafts", async () => {
  for (const response of [Response.json({ ok: false }, { status: 500 }), Response.json({ ok: true }), new Response("not json")]) {
    let calls = 0;
    const before = { ...draft };
    await assert.rejects(saveActivityDraft("org", draft, async () => { calls++; return response; }));
    assert.equal(calls, 1);
    assert.deepEqual(draft, before);
  }
  await assert.rejects(saveActivityDraft("org", draft, async () => { throw new Error("Network unavailable"); }));
});
