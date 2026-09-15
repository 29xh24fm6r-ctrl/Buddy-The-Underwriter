import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const deal = "00000000-0000-0000-0000-000000000001",
  bank = "00000000-0000-0000-0000-000000000002",
  owner = "00000000-0000-0000-0000-000000000003";
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE bank_document_templates(bank_id uuid,template_key text,name text,version text,file_path text,mime_type text,file_sha256 text,is_active boolean,metadata jsonb);
 CREATE TABLE deals(id uuid primary key,bank_id uuid,borrower_id uuid,loan_amount numeric);
 CREATE TABLE borrowers(id uuid primary key default gen_random_uuid(),bank_id uuid,legal_name text,employee_count integer);
 CREATE TABLE borrower_concierge_sessions(id uuid primary key default gen_random_uuid(),deal_id uuid unique,bank_id uuid,program text,extracted_facts jsonb,confirmed_facts jsonb,updated_at timestamptz);
 CREATE TABLE ownership_entities(id uuid primary key,deal_id uuid,display_name text,ownership_pct numeric,home_phone text,legal_action_pending boolean);
 CREATE TABLE borrower_applicant_financials(applicant_id uuid primary key,liquid_assets numeric);
 CREATE TABLE deal_loan_requests(id uuid primary key default gen_random_uuid(),deal_id uuid,bank_id uuid,sba_program text CHECK(sba_program IN ('7A','504','EXPRESS','COMMUNITY_ADVANTAGE')),use_of_proceeds jsonb,product_type text,requested_amount numeric,created_at timestamptz default now());
 CREATE TABLE deal_structured_field_confirmations(deal_id uuid,bank_id uuid,form_code text,field_key text,value jsonb,rationale text,confidence text,confirmed boolean,generated_at timestamptz,confirmed_at timestamptz,unique(deal_id,form_code,field_key));
 CREATE TABLE character_question_confirmations(deal_id uuid,ownership_entity_id uuid,field_key text,answer boolean,confirmed_at timestamptz,confirmed_by text,unique(deal_id,ownership_entity_id,field_key));
 CREATE TABLE borrower_pfs_real_estate(id uuid primary key default gen_random_uuid(),deal_id uuid,applicant_id uuid,property_label text,address text);
 CREATE TABLE borrower_pfs_notes_payable(id uuid primary key default gen_random_uuid(),deal_id uuid,applicant_id uuid,noteholder_name_address text,current_balance numeric);
 CREATE TABLE borrower_pfs_securities(id uuid primary key default gen_random_uuid(),deal_id uuid,applicant_id uuid,name_of_securities text,total_value numeric);
 INSERT INTO deals(id,bank_id) VALUES('${deal}','${bank}');
 INSERT INTO ownership_entities(id,deal_id,display_name,ownership_pct) VALUES('${owner}','${deal}','Borrower Example',100);`);
  await db.exec(
    readFileSync(
      "supabase/migrations/20260915161948_guided_package_answers.sql",
      "utf8",
    ),
  );
  return db;
}
async function answer(
  db: PGlite,
  path: string,
  table: string | null,
  column: string | null,
  value: unknown,
  expected: unknown = null,
  ownerId: string | null = null,
  character: string | null = null,
) {
  return db.query(
    "SELECT save_guided_package_answer($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)",
    [
      deal,
      bank,
      table ? path + (ownerId ? ":" + ownerId : "") : path,
      ownerId,
      table,
      column,
      table ? path : null,
      JSON.stringify(value),
      JSON.stringify(expected),
      "text",
      character,
    ],
  );
}
test("guided answer transaction persists form fields, mirrors and rejects stale corrections", async () => {
  const db = await setup();
  try {
    await answer(
      db,
      "business.legal_name",
      "borrowers",
      "legal_name",
      "Example LLC",
    );
    await answer(
      db,
      "business.employee_count",
      "borrowers",
      "employee_count",
      0,
    );
    const row = await db.query<{
      legal_name: string;
      employee_count: number;
    }>("SELECT legal_name,employee_count FROM borrowers");
    assert.deepEqual(row.rows, [
      { legal_name: "Example LLC", employee_count: 0 },
    ]);
    await assert.rejects(() =>
      answer(
        db,
        "business.employee_count",
        "borrowers",
        "employee_count",
        9,
        null,
      ),
    );
    assert.equal(
      (
        await db.query<{
          employee_count: number;
        }>("SELECT employee_count FROM borrowers")
      ).rows[0].employee_count,
      0,
    );
    await answer(
      db,
      "owner.legal_action_pending",
      "ownership_entities",
      "legal_action_pending",
      false,
      null,
      owner,
      "legal_action_pending",
    );
    assert.equal(
      (
        await db.query<{
          answer: boolean;
        }>("SELECT answer FROM character_question_confirmations")
      ).rows[0].answer,
      false,
    );
    await answer(db, "A01", null, null, "Expand our existing business");
    assert.equal(
      (
        await db.query<any>(
          "SELECT confirmed_facts FROM borrower_concierge_sessions",
        )
      ).rows[0].confirmed_facts.package_answers.A01.value,
      "Expand our existing business",
    );
  } finally {
    await db.close();
  }
});
test("cross-deal owner, arbitrary fields and anonymous writes are rejected", async () => {
  const db = await setup();
  try {
    await assert.rejects(() =>
      answer(
        db,
        "owner.home_phone",
        "ownership_entities",
        "home_phone",
        "123",
        null,
        "00000000-0000-0000-0000-000000000099",
      ),
    );
    await assert.rejects(() =>
      answer(db, "business.legal_name", "deals", "bank_id", bank),
    );
    const privilege = await db.query<{
      allowed: boolean;
    }>(
      "SELECT has_function_privilege('anon','public.save_guided_package_answer(uuid,uuid,text,uuid,text,text,text,jsonb,jsonb,text,text)','EXECUTE') AS allowed",
    );
    assert.equal(privilege.rows[0].allowed, false);
  } finally {
    await db.close();
  }
});
test("schedule edits update the same row and cannot attach another owners row", async () => {
  const db = await setup();
  try {
    const sql = "SELECT save_guided_pfs_row($1,$2,$3,$4,$5,$6::jsonb,$7) AS id";
    const first = await db.query<{
      id: string;
    }>(sql, [
      deal,
      bank,
      owner,
      "borrower_pfs_notes_payable",
      null,
      JSON.stringify({
        noteholder_name_address: "Local bank",
        current_balance: 100,
      }),
      false,
    ]);
    await db.query(sql, [
      deal,
      bank,
      owner,
      "borrower_pfs_notes_payable",
      first.rows[0].id,
      JSON.stringify({ current_balance: 50 }),
      false,
    ]);
    assert.equal(
      (await db.query("SELECT * FROM borrower_pfs_notes_payable")).rows.length,
      1,
    );
    assert.equal(
      Number(
        (
          await db.query<any>(
            "SELECT current_balance FROM borrower_pfs_notes_payable",
          )
        ).rows[0].current_balance,
      ),
      50,
    );
    await assert.rejects(() =>
      db.query(sql, [
        deal,
        bank,
        owner,
        "borrower_pfs_notes_payable",
        null,
        JSON.stringify({ deal_id: bank }),
        false,
      ]),
    );
  } finally {
    await db.close();
  }
});
test("program and financing purposes update the canonical request and confirmed form classification", async () => {
  const db = await setup();
  try {
    await answer(
      db,
      "loan.sba_program",
      "deal_loan_requests",
      "sba_program",
      "7A",
    );
    await answer(
      db,
      "loan.sba_program",
      "deal_loan_requests",
      "sba_program",
      "504",
      "7A",
    );
    const purposes = [
      { category: "equipment", amount: 15000, description: "Machine A" },
      { category: "equipment", amount: 20000, description: "Machine B" },
    ];
    await answer(
      db,
      "loan.use_of_proceeds",
      "deal_loan_requests",
      "use_of_proceeds",
      purposes,
    );
    const request = (await db.query<any>("SELECT * FROM deal_loan_requests"))
      .rows[0];
    assert.equal(request.bank_id, bank);
    assert.equal(request.product_type, "SBA_504");
    assert.deepEqual(request.use_of_proceeds, purposes);
    const confirmation = (
      await db.query<any>("SELECT * FROM deal_structured_field_confirmations")
    ).rows[0];
    assert.equal(confirmation.confirmed, true);
    assert.deepEqual(confirmation.value.categorized, purposes);
  } finally {
    await db.close();
  }
});
