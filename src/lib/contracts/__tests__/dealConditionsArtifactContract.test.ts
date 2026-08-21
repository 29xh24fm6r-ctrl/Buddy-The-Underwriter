import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260821150646_normalize_deal_conditions_artifact_verification_contract.sql",
);
const migration = readFileSync(migrationPath, "utf8");

test("deal_conditions exposes the complete artifact-verification persistence contract", () => {
  for (const column of [
    "category",
    "source_key",
    "required_docs",
    "borrower_message_subject",
    "borrower_message_body",
    "reminder_subscription_id",
    "created_by",
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}\\b`));
  }

  assert.match(migration, /deal_conditions_deal_source_key_uidx/);
  assert.match(migration, /where source_key is not null/);
});

test("deal_conditions RLS is tenant-correlated and never uses the legacy tautology", () => {
  assert.doesNotMatch(migration, /m\.bank_id\s*=\s*m\.bank_id/);
  assert.match(
    migration,
    /m\.bank_id\s*=\s*deal_conditions\.bank_id/g,
  );
  assert.match(migration, /to authenticated/g);
  assert.match(migration, /alter table public\.deal_conditions enable row level security/);
});
