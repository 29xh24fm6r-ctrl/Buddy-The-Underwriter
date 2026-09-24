import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { setupConditionDatabase } from "../../../../test/utils/conditionDatabase";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
const { computeAndPersistForDeal } = require("../computeAndPersist");
const { handleRequestDocuments } = require("../../../core/actions/execution/handlers/requestDocuments");
const { EXPECTED_DOCS } = require("../rules");

test("borrower recomputation uses persisted evidence, preserves review and fails closed", async () => {
  const { db, sb, fail } = await setupConditionDatabase();
  const opts = { supabase: sb, dealId: "deal", product: "SBA_7A", isSba: true, hasRealEstateCollateral: false,
    presentDocKeys: EXPECTED_DOCS.map((doc: any) => doc.key) };
  try {
    assert.equal((await computeAndPersistForDeal(opts)).ok, true);
    const rows = (await db.query<{code:string;status:string;bank_id:string}>("select code,status,bank_id from deal_conditions order by code")).rows;
    assert.equal(rows.length, 3, "borrower presence claims cannot suppress missing persisted evidence");
    assert.ok(rows.every(row => row.status === "open" && row.bank_id === "bank" && row.code));
    await db.exec("update deal_conditions set status='waived' where code='COND_MISSING_PFS'; insert into deal_condition_evidence(condition_id,kind,label) select id,'review','Reviewed by lender' from deal_conditions where code='COND_MISSING_PFS';");
    await computeAndPersistForDeal(opts);
    assert.equal((await db.query("select * from deal_conditions")).rows.length, 3);
    assert.equal((await db.query<{status:string}>("select status from deal_conditions where code='COND_MISSING_PFS'")).rows[0].status, "waived");
    assert.equal((await db.query("select * from deal_condition_evidence")).rows.length, 1);
    fail("deal_documents");
    await assert.rejects(computeAndPersistForDeal(opts), /condition_evidence_unavailable/);
    fail("deal_conditions");
    await assert.rejects(computeAndPersistForDeal(opts), /condition_lookup_failed/);
  } finally { await db.close(); }
});

test("canonical document requests persist on production schema and never claim a failed insert succeeded", async () => {
  const { db, sb, fail } = await setupConditionDatabase();
  const input = { dealId: "deal", bankId: "bank", executedBy: "reviewer" };
  try {
    const created = await handleRequestDocuments(sb, input);
    assert.equal(created.ok, true);
    assert.ok(created.targetRecordId);
    await db.exec("update deal_conditions set status='satisfied'");
    assert.equal((await handleRequestDocuments(sb, input)).status, "already_exists");
    assert.equal((await db.query("select * from deal_conditions")).rows.length, 1);
    fail("deal_conditions");
    assert.equal((await handleRequestDocuments(sb, input)).status, "failed");
    fail("");
    await db.exec("delete from deal_conditions; alter table deal_conditions add constraint reject_test_write check(false)");
    assert.equal((await handleRequestDocuments(sb, input)).status, "failed");
  } finally { await db.close(); }
});
