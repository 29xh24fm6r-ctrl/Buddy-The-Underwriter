import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("AI gateway budget admission is durable, atomic, and service-role only", () => {
  const migration = read(
    "supabase/migrations/20260827060000_ai_gateway_durable_governance.sql",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.ai_gateway_daily_budgets/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.ai_gateway_budget_reservations/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /actual_tokens = reserved_tokens/);
  assert.match(migration, /tokens_consumed = tokens_consumed \+ v_expired/);
  assert.match(migration, /'underwriter', 'embedder'/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(
    migration,
    /REVOKE EXECUTE ON FUNCTION public\.reserve_ai_gateway_tokens\(text, bigint, bigint\)[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.settle_ai_gateway_tokens\(uuid, bigint\)[\s\S]*TO service_role/,
  );
  assert.doesNotMatch(migration, /GRANT[\s\S]+TO (anon|authenticated)/);
});

test("gateway fails closed on missing audit evidence and tracks streamed usage", () => {
  const gateway = read("src/lib/ai/gateway.ts");
  const ledger = read("src/lib/ai/ledger.ts");
  const embed = read("src/lib/ai/embed.ts");
  assert.match(gateway, /reserveDurableBudget/);
  assert.match(gateway, /settleDurableBudget/);
  assert.match(gateway, /GatewayAuditPersistenceError/);
  assert.match(gateway, /outputTokenUpperBound \+= estimateTextTokenUpperBound\(chunk\)/);
  assert.match(ledger, /Promise<boolean>/);
  assert.match(ledger, /return false/);
  assert.match(embed, /reserveGatewayBudget\(\s*"embedder"/);
  assert.match(embed, /EmbeddingAuditPersistenceError/);
  assert.doesNotMatch(gateway, /streaming endpoint doesn't return usageMetadata[\s\S]*tokensIn: 0/);
});

test("reserve_ai_gateway_tokens disambiguates its RETURNS TABLE columns from the budget table", () => {
  // Regression: the original definition declared output columns named
  // tokens_consumed / tokens_reserved, which become PL/pgSQL variables and
  // collide with the identically named ai_gateway_daily_budgets columns.
  // Postgres raised 42702 ("column reference ... is ambiguous") on every call,
  // and because the gateway reserves budget before dispatching, that took down
  // OCR, document extraction and every other AI path in the app.
  const fix = read(
    "supabase/migrations/20260827200000_fix_ai_gateway_reserve_ambiguity.sql",
  );

  // Every UPDATE against the budget table must alias it and qualify the
  // column references it reads.
  const updates = fix.match(/UPDATE public\.ai_gateway_daily_budgets[\s\S]*?;/g) ?? [];
  assert.ok(updates.length >= 2, "expected the budget table to be updated at least twice");
  for (const stmt of updates) {
    assert.match(stmt, /UPDATE public\.ai_gateway_daily_budgets AS b\b/);
    // A bare tokens_* is only legal as an UPDATE ... SET target. Anywhere it
    // is *read* it must be qualified, or it resolves to the RETURNS TABLE
    // variable of the same name instead of the column.
    for (const m of stmt.matchAll(/(b\.)?tokens_(?:consumed|reserved)(\s*=)?/g)) {
      const qualified = Boolean(m[1]);
      const isSetTarget = Boolean(m[2]);
      assert.ok(
        qualified || isSetTarget,
        `unqualified budget column read "${m[0].trim()}" in: ${stmt}`,
      );
    }
  }

  // The RPC contract src/lib/ai/budget.ts reads must be preserved.
  assert.match(fix, /RETURNS TABLE \(\s*allowed boolean,\s*reservation_id uuid,\s*tokens_consumed bigint,\s*tokens_reserved bigint\s*\)/);
  assert.match(fix, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(
    fix,
    /REVOKE EXECUTE ON FUNCTION public\.reserve_ai_gateway_tokens\(text, bigint, bigint\)[\s\S]*FROM PUBLIC, anon, authenticated/,
  );
  assert.doesNotMatch(fix, /GRANT[\s\S]+TO (anon|authenticated)/);
});
