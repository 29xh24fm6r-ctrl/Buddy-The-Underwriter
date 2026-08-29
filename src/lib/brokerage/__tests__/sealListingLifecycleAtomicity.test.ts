import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  "src/app/api/brokerage/deals/[dealId]/seal/route.ts",
  "utf8",
);
const migration = readFileSync(
  "supabase/migrations/20260829003000_atomic_seal_listing_lifecycle.sql",
  "utf8",
);

test("seal route delegates package, listing, and deal state to one RPC", () => {
  assert.match(route, /\.rpc\(\s*"create_buddy_seal_listing"/);
  assert.doesNotMatch(
    route,
    /\.from\("buddy_sealed_packages"\)[\s\S]{0,160}\.insert\(/,
  );
  assert.doesNotMatch(
    route,
    /\.from\("marketplace_listings"\)[\s\S]{0,160}\.insert\(/,
  );
  assert.match(route, /transitionError \|\| !sealedPackageId \|\| !listingId/);
  assert.match(route, /error: "seal_commit_failed"/);
});

test("unseal route cannot report success from partial best-effort writes", () => {
  assert.match(route, /\.rpc\(\s*"unseal_buddy_marketplace_listing"/);
  assert.doesNotMatch(
    route,
    /\.from\("buddy_sealed_packages"\)[\s\S]{0,160}\.update\(/,
  );
  assert.doesNotMatch(
    route,
    /\.from\("marketplace_listings"\)[\s\S]{0,160}\.delete\(/,
  );
  assert.match(route, /error: "unseal_commit_failed"/);
});

test("seal transaction re-proves tenant, bundle identity, and artifact paths", () => {
  for (const proof of [
    "d.bank_id = p_bank_id",
    "bundle.id::text = p_sealed_snapshot #>> '{tridentFinal,bundleId}'",
    "bundle.deal_id = p_deal_id",
    "bundle.bank_id = p_bank_id",
    "bundle.mode = 'final'",
    "bundle.status = 'succeeded'",
    "bundle.superseded_at is null",
    "bundle.business_plan_pdf_path = p_final_business_plan_path",
    "bundle.projections_xlsx_path = p_final_projections_path",
    "bundle.feasibility_pdf_path = p_final_feasibility_path",
  ]) {
    assert.ok(migration.includes(proof), `missing seal proof: ${proof}`);
  }
});

test("seal creation rolls all lifecycle writes back together on failure", () => {
  const fn = migration.slice(
    migration.indexOf("create or replace function public.create_buddy_seal_listing"),
    migration.indexOf("create or replace function public.unseal_buddy_marketplace_listing"),
  );
  const sealedInsert = fn.indexOf("insert into public.buddy_sealed_packages");
  const listingInsert = fn.indexOf("insert into public.marketplace_listings");
  const dealUpdate = fn.indexOf("update public.deals");
  const proven = fn.indexOf("seal_deal_transition_unproven");

  assert.ok(sealedInsert >= 0);
  assert.ok(listingInsert > sealedInsert);
  assert.ok(dealUpdate > listingInsert);
  assert.ok(proven > dealUpdate);
  assert.doesNotMatch(fn, /exception\s+when|listing_insert_failed/);
});

test("unseal proves every row before returning success", () => {
  const fn = migration.slice(
    migration.indexOf("create or replace function public.unseal_buddy_marketplace_listing"),
    migration.indexOf("revoke all on function public.create_buddy_seal_listing"),
  );
  for (const proof of [
    "unseal_active_package_not_found",
    "unseal_package_transition_unproven",
    "unseal_listing_transition_unproven",
    "unseal_deal_transition_unproven",
  ]) {
    assert.ok(fn.includes(proof), `missing unseal proof: ${proof}`);
  }
  assert.match(fn, /return query select v_sealed_package_id, v_listing_id/);
});

test("privileged lifecycle RPCs have empty search paths and service-role-only grants", () => {
  assert.equal((migration.match(/security definer/g) ?? []).length, 2);
  assert.equal((migration.match(/set search_path = ''/g) ?? []).length, 2);
  assert.match(
    migration,
    /revoke all on function public\.create_buddy_seal_listing[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /revoke all on function public\.unseal_buddy_marketplace_listing\(uuid,uuid,text\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.create_buddy_seal_listing[\s\S]*to service_role/,
  );
  assert.match(
    migration,
    /grant execute on function public\.unseal_buddy_marketplace_listing\(uuid,uuid,text\)[\s\S]*to service_role/,
  );
});

test("rate-card database errors fail closed instead of masquerading as a miss", () => {
  const lookup = route.indexOf('from("marketplace_rate_card")');
  const errorGuard = route.indexOf("if (rateError)", lookup);
  const missGuard = route.indexOf("if (!rateRow)", lookup);
  assert.ok(lookup >= 0 && errorGuard > lookup);
  assert.ok(missGuard > errorGuard);
  assert.match(route, /error: "seal_state_unavailable"/);
});
