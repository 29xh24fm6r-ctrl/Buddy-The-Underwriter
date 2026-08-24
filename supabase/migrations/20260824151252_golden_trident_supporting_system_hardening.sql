begin;

-- Record the governed completion-factory apply under its canonical repository
-- version when Supabase assigned an execution-time version.
update supabase_migrations.schema_migrations
set version = '20260821190000'
where name = 'golden_trident_completion_factory'
  and version <> '20260821190000'
  and not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260821190000'
  );

-- Cover the release-manifest relationship used by Trident status and audit reads.
create index if not exists buddy_trident_bundles_source_spread_id_idx
  on public.buddy_trident_bundles (source_spread_id)
  where source_spread_id is not null;

commit;
