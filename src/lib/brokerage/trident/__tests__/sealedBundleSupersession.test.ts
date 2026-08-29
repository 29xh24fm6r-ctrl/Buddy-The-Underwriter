import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260829010000_sealed_trident_supersession_retention.sql",
  "utf8",
);

test("active seals fence replacement final-bundle admission", () => {
  const guard = migration.indexOf("if p_mode = 'final' and exists");
  const insert = migration.indexOf("insert into public.buddy_trident_bundles", guard);
  assert.ok(guard >= 0, "missing active-seal admission guard");
  assert.ok(insert > guard, "the seal guard must run before a replacement lease is inserted");
  assert.match(migration, /sealed\.unsealed_at is null/);
  assert.match(migration, /raise exception 'active_seal_preserves_trident_bundle'/);
});

test("publication rechecks the seal before superseding the certified bundle", () => {
  const finalize = migration.indexOf("create or replace function public.finalize_trident_bundle_run");
  const sealGuard = migration.indexOf("sealed.sealed_snapshot #>> '{tridentFinal,bundleId}'", finalize);
  const supersession = migration.indexOf("update public.buddy_trident_bundles set superseded_at", finalize);
  assert.ok(finalize >= 0 && sealGuard > finalize, "missing finalization seal check");
  assert.ok(supersession > sealGuard, "publication must prove seal compatibility before supersession");
});

test("direct supersession of the actively sealed bundle is database-blocked", () => {
  assert.match(migration, /create or replace function public\.protect_active_sealed_trident_bundle/);
  assert.match(migration, /before update of superseded_at/);
  assert.match(migration, /sealed\.sealed_snapshot #>> '\{tridentFinal,bundleId\}' = old\.id::text/);
  assert.match(migration, /old\.superseded_at is null/);
  assert.match(migration, /new\.superseded_at is not null/);
});

test("historical repair requires bundle, tenant, mode, status, and artifact-path proof", () => {
  for (const proof of [
    "bound.id::text = sealed.sealed_snapshot #>> '{tridentFinal,bundleId}'",
    "bound.deal_id = sealed.deal_id",
    "bound.bank_id = sealed.bank_id",
    "bound.mode = 'final'",
    "bound.status = 'succeeded'",
    "sealed.final_business_plan_path = bound.business_plan_pdf_path",
    "sealed.final_projections_path = bound.projections_xlsx_path",
    "sealed.final_feasibility_path = bound.feasibility_pdf_path",
  ]) {
    assert.ok(migration.includes(proof), `missing reconciliation proof: ${proof}`);
  }
  const supersedeOther = migration.indexOf("candidate.id <> binding.bound_bundle_id");
  const restoreBound = migration.indexOf("set superseded_at = null", supersedeOther);
  assert.ok(supersedeOther >= 0 && restoreBound > supersedeOther);
});

test("reconciliation retains every row and storage object", () => {
  assert.doesNotMatch(migration, /delete\s+from\s+public\.buddy_trident_bundles/i);
  assert.doesNotMatch(migration, /delete\s+from\s+storage\.objects/i);
  assert.doesNotMatch(migration, /storage\.remove/i);
  assert.match(migration, /newer unsealed[\s\S]*remain retained as superseded forensic evidence/i);
});

test("new privileged functions remain service-role only", () => {
  assert.match(
    migration,
    /revoke all on function public\.acquire_trident_bundle_run\(uuid,text,text,text,jsonb\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public\.finalize_trident_bundle_run\(uuid,uuid,text\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(migration, /grant execute on function public\.acquire_trident_bundle_run[\s\S]*to service_role/);
  assert.match(migration, /grant execute on function public\.finalize_trident_bundle_run[\s\S]*to service_role/);
});
