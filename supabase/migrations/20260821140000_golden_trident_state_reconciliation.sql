-- Reconcile legacy Golden Trident state with the atomic factory contract.
-- Idempotent: reruns only touch rows that still violate the invariants.

update public.buddy_trident_bundles
set
  status = 'failed',
  generation_error = coalesce(
    nullif(generation_error, ''),
    'Legacy Golden Trident run quarantined: active run lacked a valid atomic lease or its lease expired'
  ),
  stage_error_json = coalesce(stage_error_json, '{}'::jsonb) ||
    jsonb_build_object(
      'code', 'legacy_atomic_lease_quarantine',
      'quarantined_at', clock_timestamp()
    ),
  generation_completed_at = coalesce(generation_completed_at, clock_timestamp()),
  last_heartbeat_at = coalesce(last_heartbeat_at, clock_timestamp()),
  lease_expires_at = null,
  superseded_at = coalesce(superseded_at, clock_timestamp())
where status in ('pending', 'running')
  and (
    lease_token is null
    or lease_expires_at is null
    or input_hash is null
    or length(input_hash) <> 64
    or snapshot_manifest_json is null
    or lease_expires_at < clock_timestamp()
  );

update public.buddy_trident_bundles
set
  status = 'failed',
  generation_error = coalesce(
    nullif(generation_error, ''),
    'Legacy Golden Trident success quarantined: bundle predates certified release-gate enforcement'
  ),
  stage_error_json = coalesce(stage_error_json, '{}'::jsonb) ||
    jsonb_build_object(
      'code', 'legacy_uncertified_success_quarantine',
      'quarantined_at', clock_timestamp()
    ),
  release_gate_json = coalesce(release_gate_json, '{}'::jsonb) ||
    jsonb_build_object(
      'ok', false,
      'legacy_quarantine', true,
      'reason', 'Bundle predates certified release-gate enforcement'
    ),
  generation_completed_at = coalesce(generation_completed_at, generated_at, clock_timestamp()),
  superseded_at = coalesce(superseded_at, clock_timestamp()),
  lease_expires_at = null
where status = 'succeeded'
  and mode = 'final'
  and (
    coalesce(release_gate_json ->> 'ok', 'false') <> 'true'
    or business_plan_pdf_path is null
    or feasibility_pdf_path is null
    or projections_xlsx_path is null
  );

update public.buddy_trident_bundles
set generation_completed_at = coalesce(generation_completed_at, generated_at, clock_timestamp())
where status in ('succeeded', 'failed')
  and generation_completed_at is null;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.buddy_trident_bundles'::regclass
      and conname = 'buddy_trident_active_atomic_contract_check'
  ) then
    alter table public.buddy_trident_bundles
      add constraint buddy_trident_active_atomic_contract_check
      check (
        status not in ('pending', 'running')
        or (
          lease_token is not null
          and lease_expires_at is not null
          and input_hash is not null
          and length(input_hash) = 64
          and snapshot_manifest_json is not null
          and last_heartbeat_at is not null
          and lease_expires_at > last_heartbeat_at
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.buddy_trident_bundles'::regclass
      and conname = 'buddy_trident_final_success_certified_check'
  ) then
    alter table public.buddy_trident_bundles
      add constraint buddy_trident_final_success_certified_check
      check (
        status <> 'succeeded'
        or mode <> 'final'
        or (
          release_gate_json ->> 'ok' = 'true'
          and business_plan_pdf_path is not null
          and feasibility_pdf_path is not null
          and projections_xlsx_path is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.buddy_trident_bundles'::regclass
      and conname = 'buddy_trident_terminal_completion_check'
  ) then
    alter table public.buddy_trident_bundles
      add constraint buddy_trident_terminal_completion_check
      check (
        status not in ('succeeded', 'failed')
        or generation_completed_at is not null
      );
  end if;
end
$constraints$;

comment on constraint buddy_trident_active_atomic_contract_check
  on public.buddy_trident_bundles
  is 'Every active Golden Trident run must carry a complete, live atomic lease and immutable input snapshot.';

comment on constraint buddy_trident_final_success_certified_check
  on public.buddy_trident_bundles
  is 'A final Golden Trident bundle may be published as succeeded only with a passing release gate and all required artifacts.';

comment on constraint buddy_trident_terminal_completion_check
  on public.buddy_trident_bundles
  is 'Every terminal Golden Trident run must record its completion timestamp.';

notify pgrst, 'reload schema';
