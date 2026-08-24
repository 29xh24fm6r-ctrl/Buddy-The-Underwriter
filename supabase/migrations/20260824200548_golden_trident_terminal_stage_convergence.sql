begin;

-- Golden Trident terminal-state convergence.
-- A terminal bundle is the authoritative aggregate state. Any unfinished child
-- stage must become terminal in the same transaction so resumability,
-- observability, and operator dashboards cannot disagree.

create or replace function public.normalize_trident_terminal_bundle_stages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if new.status not in ('succeeded', 'failed') then
    return new;
  end if;

  update public.buddy_trident_bundle_stages s
     set status = case when new.status = 'failed' then 'failed' else 'skipped' end,
         error_json = coalesce(s.error_json, '{}'::jsonb)
           || jsonb_build_object(
             'code', 'parent_bundle_terminal',
             'bundle_status', new.status,
             'bundle_error', new.generation_error,
             'reconciled_at', v_now
           ),
         completed_at = coalesce(s.completed_at, v_now),
         updated_at = v_now
   where s.bundle_id = new.id
     and s.status in ('pending', 'running');

  return new;
end;
$$;

revoke all on function public.normalize_trident_terminal_bundle_stages()
  from public, anon, authenticated;

create or replace trigger buddy_trident_terminal_stage_convergence
after insert or update of status
on public.buddy_trident_bundles
for each row
when (new.status in ('succeeded', 'failed'))
execute function public.normalize_trident_terminal_bundle_stages();

update public.buddy_trident_bundle_stages s
   set status = case when b.status = 'failed' then 'failed' else 'skipped' end,
       error_json = coalesce(s.error_json, '{}'::jsonb)
         || jsonb_build_object(
           'code', 'parent_bundle_terminal',
           'bundle_status', b.status,
           'bundle_error', b.generation_error,
           'reconciled_at', clock_timestamp(),
           'backfill', true
         ),
       completed_at = coalesce(s.completed_at, b.generation_completed_at, clock_timestamp()),
       updated_at = clock_timestamp()
  from public.buddy_trident_bundles b
 where b.id = s.bundle_id
   and b.status in ('succeeded', 'failed')
   and s.status in ('pending', 'running');

comment on function public.normalize_trident_terminal_bundle_stages() is
  'Trigger-only invariant: terminal Golden Trident bundles atomically terminalize every unfinished child stage.';

notify pgrst, 'reload schema';

commit;
