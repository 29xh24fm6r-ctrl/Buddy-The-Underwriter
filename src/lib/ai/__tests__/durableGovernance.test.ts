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
  assert.match(gateway, /reserveDurableBudget/);
  assert.match(gateway, /settleDurableBudget/);
  assert.match(gateway, /GatewayAuditPersistenceError/);
  assert.match(gateway, /outputTokens = Math\.max\(1, Math\.ceil\(outputChars \/ 2\)\)/);
  assert.match(ledger, /Promise<boolean>/);
  assert.match(ledger, /return false/);
  assert.doesNotMatch(gateway, /streaming endpoint doesn't return usageMetadata[\s\S]*tokensIn: 0/);
});
