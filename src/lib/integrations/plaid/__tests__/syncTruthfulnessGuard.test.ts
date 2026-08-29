import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/webhooks/[vendor]/route.ts", "utf8");
const sync = readFileSync("src/lib/integrations/plaid/sync.ts", "utf8");

test("Plaid webhook distinguishes connection absence from unavailable state", () => {
  const lookup = route.indexOf('const { data: connection, error: connectionError }');
  const readFailure = route.indexOf('error: "connection_state_unavailable"', lookup);
  const absent = route.indexOf('if (!connection)', readFailure);

  assert.ok(lookup >= 0);
  assert.ok(readFailure > lookup);
  assert.ok(absent > readFailure);
  assert.match(route.slice(readFailure, absent), /status: 503/);
});

test("Plaid transaction webhooks never acknowledge a failed sync", () => {
  const guardedFailures = route.match(/error: "transaction_sync_failed"/g) ?? [];
  assert.equal(guardedFailures.length, 2);

  for (const webhookCode of ["INITIAL_UPDATE", "TRANSACTIONS_REMOVED"]) {
    const start = route.indexOf(webhookCode);
    const syncCall = route.indexOf("syncTransactions(connection.id, supabase)", start);
    const failureGuard = route.indexOf("if (!result.ok)", syncCall);
    const unavailable = route.indexOf('error: "transaction_sync_failed"', failureGuard);
    const success = route.indexOf("return NextResponse.json({ ok: true", unavailable);

    assert.ok(syncCall > start, `${webhookCode} must invoke sync`);
    assert.ok(failureGuard > syncCall, `${webhookCode} must inspect the result`);
    assert.ok(unavailable > failureGuard, `${webhookCode} must expose failure`);
    assert.ok(success > unavailable, `${webhookCode} may succeed only after proof`);
  }
});

test("Plaid item lifecycle acknowledgements require returned-row status proof", () => {
  assert.equal(
    (route.match(/\.select\("id, status"\)\s*\.maybeSingle\(\)/g) ?? []).length,
    2,
  );
  assert.equal(
    (route.match(/error: "connection_status_persistence_failed"/g) ?? []).length,
    2,
  );
  assert.match(route, /updated\?\.status !== "error"/);
  assert.match(route, /updated\?\.status !== requestedStatus/);
});

test("Plaid sync fails closed before advancing its cursor", () => {
  for (const marker of [
    "accounts_upsert_failed",
    "accounts_read_failed",
    "transaction_account_missing",
    "transactions_upsert_failed",
    "transactions_remove_failed",
    "cursor_persistence_failed",
  ]) {
    assert.match(sync, new RegExp(marker), `missing ${marker}`);
  }

  const accountWrite = sync.indexOf("accounts_upsert_failed");
  const transactionWrite = sync.indexOf("transactions_upsert_failed");
  const removal = sync.indexOf("transactions_remove_failed");
  const cursorWrite = sync.indexOf("const { data: cursorWrite");
  const cursorProof = sync.indexOf("cursorWrite?.plaid_sync_cursor !== cursor", cursorWrite);

  assert.ok(accountWrite >= 0);
  assert.ok(transactionWrite > accountWrite);
  assert.ok(removal > transactionWrite);
  assert.ok(cursorWrite > removal);
  assert.ok(cursorProof > cursorWrite);
  assert.ok(!sync.includes(".filter((r) => r.account_id != null)"));
});

test("sync failure evidence cannot convert a failed cycle into success", () => {
  const catchAt = sync.indexOf("} catch (err: any) {");
  const evidence = sync.indexOf("failure evidence persistence failed", catchAt);
  const failureReturn = sync.indexOf("return { ok: false, error:", evidence);
  const successReturn = sync.indexOf("return { ok: true, added:", failureReturn);

  assert.ok(catchAt >= 0);
  assert.ok(evidence > catchAt);
  assert.ok(failureReturn > evidence);
  assert.ok(successReturn > failureReturn);
});
