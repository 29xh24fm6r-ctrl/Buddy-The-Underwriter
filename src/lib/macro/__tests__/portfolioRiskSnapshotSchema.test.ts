import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION =
  "supabase/migrations/20260829100000_portfolio_risk_snapshots.sql";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

test("portfolio snapshot migration owns the complete nightly schema contract", () => {
  const sql = read(MIGRATION);

  assert.match(
    sql,
    /create table if not exists public\.portfolio_risk_snapshots/i,
  );
  assert.match(sql, /primary key\s*\(bank_id,\s*as_of_date\)/i);
  assert.match(
    sql,
    /bank_id uuid not null references public\.banks\(id\) on delete cascade/i,
  );

  for (const column of [
    "total_exposure",
    "risk_weighted_exposure",
    "total_decisions",
    "decisions_with_exceptions",
    "exception_rate",
    "committee_required_count",
    "committee_override_rate",
    "concentration_json",
  ]) {
    assert.match(sql, new RegExp(`\\b${column}\\b`, "i"));
  }

  assert.match(
    sql,
    /alter table public\.portfolio_risk_snapshots enable row level security/i,
  );
  assert.match(sql, /to service_role\s+using\s*\(true\)\s+with check\s*\(true\)/is);
  assert.match(
    sql,
    /revoke all on table public\.portfolio_risk_snapshots\s+from public, anon, authenticated/i,
  );
  assert.match(sql, /notify pgrst,\s*'reload schema'/i);
});

test("portfolio writes use deterministic conflict identity and returned-row proof", () => {
  const source = read("src/lib/macro/aggregatePortfolio.ts");

  assert.match(
    source,
    /\.upsert\(snapshot,\s*\{\s*onConflict:\s*"bank_id,as_of_date"\s*\}\)/,
  );
  assert.match(source, /\.select\(PORTFOLIO_SNAPSHOT_COLUMNS\)\s*\.single\(\)/s);
  assert.match(source, /portfolioSnapshotMatches\(persisted, snapshot\)/);
  assert.match(source, /Portfolio snapshot persistence proof failed/);
});

test("schema manifest records portfolio snapshot provenance", () => {
  const manifest = JSON.parse(
    read("scripts/audit/schema-manifest.json"),
  ) as Array<{ name: string; type: string; migration: string }>;

  assert.deepEqual(
    manifest.find((entry) => entry.name === "portfolio_risk_snapshots"),
    {
      name: "portfolio_risk_snapshots",
      type: "table",
      migration: "20260829100000_portfolio_risk_snapshots.sql",
    },
  );
});
