import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/borrower/plaid/[action]/route.ts", "utf8");
const exchange = readFileSync("src/lib/integrations/plaid/exchangeToken.ts", "utf8");
const connectCard = readFileSync("src/components/borrower/PlaidConnectCard.tsx", "utf8");
const progressRoute = readFileSync("src/app/api/borrower/intake/progress/route.ts", "utf8");

test("Plaid ownership selectors are scoped to the authenticated deal", () => {
  const helper = route.indexOf("async function scopeOwnershipEntity");
  const idFilter = route.indexOf('.eq("id", rawOwnershipEntityId)', helper);
  const dealFilter = route.indexOf('.eq("deal_id", dealId)', idFilter);
  const mismatch = route.indexOf('error: "ownership_entity_mismatch"', dealFilter);

  assert.ok(helper >= 0);
  assert.ok(idFilter > helper);
  assert.ok(dealFilter > idFilter);
  assert.ok(mismatch > dealFilter);
  assert.match(route, /error: "ownership_state_unavailable"/);
  assert.match(route, /error: "invalid_ownership_entity_id"/);
});

test("both link-token and exchange actions prove ownership scope before provider work", () => {
  const linkStart = route.indexOf('if (action === "link-token")');
  const linkScope = route.indexOf("await scopeOwnershipEntity(", linkStart);
  const linkProvider = route.indexOf("await createLinkToken(", linkScope);

  const exchangeStart = route.indexOf('if (action === "exchange")');
  const exchangeScope = route.indexOf("await scopeOwnershipEntity(", exchangeStart);
  const exchangeProvider = route.indexOf("await exchangePublicToken(", exchangeScope);

  assert.ok(linkScope > linkStart);
  assert.ok(linkProvider > linkScope);
  assert.ok(exchangeScope > exchangeStart);
  assert.ok(exchangeProvider > exchangeScope);
});

test("failed initial sync cannot be reported as a connected bank", () => {
  const syncCall = route.indexOf("await syncTransactions(");
  const syncFailure = route.indexOf("if (!syncResult.ok)", syncCall);
  const nonGreen = route.indexOf('error: "initial_sync_failed"', syncFailure);
  const unavailable = route.indexOf("status: 503", nonGreen);
  const success = route.indexOf("return NextResponse.json({ ok: true, connectionId:", unavailable);

  assert.ok(syncCall >= 0);
  assert.ok(syncFailure > syncCall);
  assert.ok(nonGreen > syncFailure);
  assert.ok(unavailable > nonGreen);
  assert.ok(success > unavailable);
  assert.match(route.slice(nonGreen, success), /connectionPersisted: true/);
});

test("exchange failures expose deterministic codes, never raw provider or database messages", () => {
  assert.match(exchange, /errorCode: ExchangePublicTokenErrorCode/);
  assert.match(exchange, /errorCode: "plaid_exchange_failed"/);
  assert.match(exchange, /errorCode: "connection_persist_failed"/);
  assert.doesNotMatch(exchange, /err\?\.message|error\?\.message|String\(err\)/);
  assert.doesNotMatch(route, /error: result\.error\b|error: msg\b/);
  assert.match(route, /error: result\.errorCode/);
  assert.match(route, /error: "unexpected_error"/);
});

test("connection persistence requires the inserted row identity", () => {
  const insert = exchange.indexOf('.from("borrower_bank_connections")');
  const selection = exchange.indexOf('.select("id")', insert);
  const proof = exchange.indexOf("if (error || !data?.id)", selection);
  const success = exchange.indexOf("return { ok: true, connectionId:", proof);

  assert.ok(insert >= 0);
  assert.ok(selection > insert);
  assert.ok(proof > selection);
  assert.ok(success > proof);
});

test("borrower UI marks connected only after a green exchange response", () => {
  const request = connectCard.indexOf('fetch("/api/borrower/plaid/exchange"');
  const responseGuard = connectCard.indexOf("if (!exchangeRes.ok || !exchangeBody?.ok)", request);
  const connected = connectCard.indexOf('setStatus("connected")', responseGuard);

  assert.ok(request >= 0);
  assert.ok(responseGuard > request);
  assert.ok(connected > responseGuard);
});

test("intake completion requires successful Plaid sync evidence", () => {
  const query = progressRoute.indexOf('.from("borrower_bank_connections")');
  const evidenceSelect = progressRoute.indexOf(
    '.select("id, last_sync_at, last_sync_error")',
    query,
  );
  const completion = progressRoute.indexOf(
    "const hasBankConnection = bankConnections.some(",
    evidenceSelect,
  );

  assert.ok(query >= 0);
  assert.ok(evidenceSelect > query);
  assert.ok(completion > evidenceSelect);
  assert.match(
    progressRoute.slice(completion, completion + 500),
    /last_sync_at[\s\S]*last_sync_error == null/,
  );
});
