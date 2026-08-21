-- Normalize Supabase migration-history versions created by manual governed applies.
-- Schema objects are already current; this migration changes ledger identifiers only.
-- On a fresh database the canonical versions already exist, so each statement is a no-op.

update supabase_migrations.schema_migrations
set version = '20260820230000'
where version = '20260821125152'
  and name = 'golden_trident_atomic_factory'
  and not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260820230000'
  );

update supabase_migrations.schema_migrations
set version = '20260821130000'
where version = '20260821125754'
  and name = 'database_reliability_hardening'
  and not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260821130000'
  );

update supabase_migrations.schema_migrations
set version = '20260821140000'
where version = '20260821135237'
  and name = 'golden_trident_state_reconciliation'
  and not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260821140000'
  );
