import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  fetchDealContext,
  fetchDealBankId,
  type DealContextReader,
  type DealContextRow,
} from "@/lib/deals/fetchDealContext";

const row: DealContextRow = {
  id: "deal-1",
  bank_id: "bank-1",
  borrower_name: "Buff Guys",
  entity_type: "LLC",
  stage: "ready",
  risk_score: 42,
  created_at: "2026-09-01T00:00:00Z",
};

function reader(result: { data: DealContextRow | null; error: { message: string } | null }) {
  const calls: string[] = [];
  const readDeal: DealContextReader = async (dealId) => {
    calls.push(dealId);
    return result;
  };
  return { readDeal, calls };
}

test("fetchDealContext reads the deal row in-process and maps the headline fields", async () => {
  const { readDeal, calls } = reader({ data: row, error: null });
  const ctx = await fetchDealContext("deal-1", { readDeal });
  assert.deepEqual(calls, ["deal-1"]);
  assert.ok(ctx.ok);
  if (!ctx.ok) return;
  assert.equal(ctx.deal.bank_id, "bank-1");
  assert.equal(ctx.deal.created_at, "2026-09-01T00:00:00Z");
  assert.equal(ctx.dealId, "deal-1");
  assert.equal(ctx.stage, "ready");
  assert.equal(ctx.borrower.name, "Buff Guys");
  assert.equal(ctx.borrower.entityType, "LLC");
  assert.equal(ctx.risk.score, 42);
});

test("fetchDealContext returns ok:false for a missing deal instead of throwing", async () => {
  const { readDeal } = reader({ data: null, error: null });
  const ctx = await fetchDealContext("deal-missing", { readDeal });
  assert.deepEqual(ctx, { ok: false, error: "deal_not_found", dealId: "deal-missing" });
});

test("fetchDealContext surfaces a query error as ok:false", async () => {
  const { readDeal } = reader({ data: null, error: { message: "boom" } });
  const ctx = await fetchDealContext("deal-1", { readDeal });
  assert.equal(ctx.ok, false);
  if (ctx.ok) return;
  assert.equal(ctx.error, "deal_query_error");
  assert.equal(ctx.details, "boom");
});

test("fetchDealContext rejects a blank deal id without reading", async () => {
  const { readDeal, calls } = reader({ data: row, error: null });
  const ctx = await fetchDealContext("  ", { readDeal });
  assert.equal(ctx.ok, false);
  assert.deepEqual(calls, []);
});

test("fetchDealBankId returns the deal's bank_id", async () => {
  const { readDeal } = reader({ data: row, error: null });
  assert.equal(await fetchDealBankId("deal-1", { readDeal }), "bank-1");
});

test("fetchDealBankId throws when the deal is missing or has no bank", async () => {
  const missing = reader({ data: null, error: null });
  await assert.rejects(() => fetchDealBankId("deal-x", { readDeal: missing.readDeal }), /Deal not found: deal_not_found/);
  const noBank = reader({ data: { ...row, bank_id: null }, error: null });
  await assert.rejects(() => fetchDealBankId("deal-1", { readDeal: noBank.readDeal }), /has no bank_id/);
});

test("guard: fetchDealContext never self-fetches the app over HTTP", () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../fetchDealContext.ts"),
    "utf8",
  );
  assert.ok(!/\bfetch\(/.test(src), "fetchDealContext.ts must not call fetch()");
  assert.ok(!/localhost:3000|127\.0\.0\.1/.test(src), "fetchDealContext.ts must not fall back to localhost");
  assert.ok(!/NEXT_PUBLIC_SITE_URL|NEXT_PUBLIC_APP_URL|VERCEL_URL/.test(src), "fetchDealContext.ts must not depend on a base URL");
});
