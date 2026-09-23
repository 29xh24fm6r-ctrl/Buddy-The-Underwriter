import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const deal = "00000000-0000-0000-0000-000000000001";
const bank = "00000000-0000-0000-0000-000000000002";
const document = "00000000-0000-0000-0000-000000000003";
const other = "00000000-0000-0000-0000-000000000004";
const signature = "public.ensure_borrower_doc_extraction_handoff(uuid,uuid,uuid)";
let db: PGlite;

before(async () => {
  db = new PGlite();
  // Reproduce production's role-specific defaults, which survive a PUBLIC revoke.
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
    CREATE TABLE document_artifacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), deal_id uuid NOT NULL,
      bank_id uuid NOT NULL, source_table text NOT NULL, source_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'queued', updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE buddy_outbox_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL,
      deal_id uuid NOT NULL, bank_id uuid, source text NOT NULL DEFAULT 'buddy',
      payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
      delivered_at timestamptz, dead_lettered_at timestamptz, claimed_at timestamptz
    );
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT SELECT, INSERT, UPDATE ON document_artifacts, buddy_outbox_events TO service_role;
  `);
  for (const name of [
    "20260923010000_ensure_borrower_doc_extraction_handoff.sql",
    "20260923132024_restrict_borrower_doc_extraction_handoff.sql",
  ]) await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec("RESET ROLE; TRUNCATE document_artifacts, buddy_outbox_events;");
  await db.query(
    "INSERT INTO document_artifacts(deal_id,bank_id,source_table,source_id,status) VALUES($1,$2,'deal_documents',$3,'classified')",
    [deal, bank, document],
  );
});

async function handoff(dealId = deal, bankId = bank, documentId = document) {
  return (await db.query<{ result: { ok: boolean; outbox_id: string; outbox_created: boolean } }>(
    "SELECT ensure_borrower_doc_extraction_handoff($1,$2,$3) AS result",
    [dealId, bankId, documentId],
  )).rows[0].result;
}
async function state() {
  return (await db.query<{ status: string; events: number }>(
    "SELECT status, (SELECT count(*)::int FROM buddy_outbox_events) AS events FROM document_artifacts",
  )).rows[0];
}

test("real SQL blocks public roles despite inherited default EXECUTE grants", async () => {
  const privileges = await db.query<{ anon: boolean; authenticated: boolean; service: boolean; definer: boolean }>(
    `SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon,
      has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') AS service,
      (SELECT prosecdef FROM pg_proc WHERE oid=$1::regprocedure) AS definer`, [signature],
  );
  assert.deepEqual(privileges.rows, [{ anon: false, authenticated: false, service: true, definer: false }]);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    try { await assert.rejects(() => handoff(), /permission denied for function/); }
    finally { await db.exec("RESET ROLE"); }
  }
});

test("real SQL queues orphaned documents once using the service role", async () => {
  await db.exec("UPDATE document_artifacts SET status='queued'; SET ROLE service_role;");
  const first = await handoff();
  const retry = await handoff();
  assert.equal(first.ok, true);
  assert.equal(first.outbox_created, true);
  assert.equal(retry.outbox_created, false);
  assert.equal(retry.outbox_id, first.outbox_id);
  assert.deepEqual(await state(), { status: "queued", events: 1 });
  const event = (await db.query<{ payload: Record<string, unknown>; source: string }>("SELECT payload,source FROM buddy_outbox_events")).rows[0];
  assert.equal(event.source, "borrower_retry");
  assert.equal(event.payload.doc_id, document);
  assert.equal(event.payload.force_refresh, false);
});

test("real SQL reuses claimed work and creates fresh work after dead-letter or delivery", async () => {
  const first = await handoff();
  await db.exec("UPDATE buddy_outbox_events SET claimed_at=now()");
  assert.equal((await handoff()).outbox_id, first.outbox_id);
  await db.exec("UPDATE buddy_outbox_events SET dead_lettered_at=now()");
  const second = await handoff();
  assert.equal(second.outbox_created, true);
  assert.notEqual(second.outbox_id, first.outbox_id);
  await db.exec("UPDATE buddy_outbox_events SET delivered_at=now() WHERE dead_lettered_at IS NULL");
  assert.equal((await handoff()).outbox_created, true);
  assert.equal((await state()).events, 3);
});

test("real SQL rejects wrong deal, bank, document, and source without writing", async () => {
  for (const args of [[other, bank, document], [deal, other, document], [deal, bank, other]] as const) {
    await assert.rejects(() => handoff(...args), /not available for extraction/);
  }
  await db.exec("UPDATE document_artifacts SET source_table='other_documents'");
  await assert.rejects(() => handoff(), /not available for extraction/);
  assert.deepEqual(await state(), { status: "classified", events: 0 });
});

test("real SQL refuses completed document states", async () => {
  await db.exec("UPDATE document_artifacts SET status='matched'");
  await assert.rejects(() => handoff(), /cannot be queued from status matched/);
  assert.deepEqual(await state(), { status: "matched", events: 0 });
});

test("real SQL rolls back artifact changes if durable enqueue fails", async () => {
  await db.exec("ALTER TABLE buddy_outbox_events ADD CONSTRAINT reject_test_enqueue CHECK (kind <> 'doc.extract')");
  try {
    await assert.rejects(() => handoff(), /reject_test_enqueue/);
    assert.deepEqual(await state(), { status: "classified", events: 0 });
  } finally {
    await db.exec("ALTER TABLE buddy_outbox_events DROP CONSTRAINT reject_test_enqueue");
  }
});
