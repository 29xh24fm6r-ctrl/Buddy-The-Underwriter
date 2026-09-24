import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setupConditionDatabase as setup } from "../../../../test/utils/conditionDatabase";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const { seedFranchiseChecklist } = createRequire(import.meta.url)("../seedFranchiseChecklist");


const params = { dealId: "deal", bankId: "bank", brandName: "7 BREW" };
test("real partial unique index supports first seed, concurrent repeats, and preserves completed evidence", async () => {
  const { db, sb } = await setup();
  try {
    assert.deepEqual(await seedFranchiseChecklist(sb, params), { ok: true });
    await db.exec("update deal_conditions set status='satisfied',reminder_subscription_id='retained-reminder' where source_key='franchise_fdd'; update deal_portal_checklist_items set status='received' where code='FRANCHISE_DISCLOSURE_DOCUMENT';");
    await db.exec("insert into deal_condition_evidence(condition_id,kind,label) select id,'doc_present','Reviewed FDD' from deal_conditions where source_key='franchise_fdd';");
    const results = await Promise.all([seedFranchiseChecklist(sb, params), seedFranchiseChecklist(sb, params)]);
    assert.ok(results.every(r=>r.ok));
    assert.equal((await db.query("select * from deal_condition_evidence")).rows.length, 1);
    assert.equal((await db.query("select * from deal_conditions")).rows.length, 3);
    assert.equal((await db.query("select * from deal_portal_checklist_items")).rows.length, 3);
    assert.deepEqual((await db.query("select status,reminder_subscription_id from deal_conditions where source_key='franchise_fdd'")).rows, [{ status: "satisfied", reminder_subscription_id: "retained-reminder" }]);
    assert.equal((await db.query<{status:string}>("select status from deal_portal_checklist_items where code='FRANCHISE_DISCLOSURE_DOCUMENT'")).rows[0].status, "received");
  } finally { await db.close(); }
});
test("initial concurrent inserts recover unique conflicts without duplication", async () => {
  const { db, sb } = await setup();
  try {
    assert.ok((await Promise.all([seedFranchiseChecklist(sb, params), seedFranchiseChecklist(sb, params)])).every(r=>r.ok));
    assert.equal((await db.query("select * from deal_conditions")).rows.length, 3);
  } finally { await db.close(); }
});
test("read/write failures and a foreign tenant cannot be reported as checklist success", async () => {
  const { db, sb, fail } = await setup();
  try {
    assert.deepEqual(await seedFranchiseChecklist(sb, { ...params, bankId: "other-bank" }), { ok: false });
    assert.equal((await db.query("select * from deal_portal_checklist_items")).rows.length, 0);
    for (const table of ["deals", "deal_portal_checklist_items", "deal_conditions"]) {
      fail(table); assert.deepEqual(await seedFranchiseChecklist(sb, params), { ok: false });
    }
  } finally { await db.close(); }
});
