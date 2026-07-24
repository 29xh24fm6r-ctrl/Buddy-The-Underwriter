-- Applied live via MCP apply_migration as reconcile_tenant_rls_tracking_gaps.
-- This file is a tracked record of that change (see supabase/migrations/README.md
-- for why local file version prefixes don't match remote schema_migrations here).
--
-- Pure reconciliation migration — no live schema change. These three
-- tables already have bank_id + RLS enabled in production (verified live),
-- but neither statement was ever captured in a tracked migration file
-- (applied via untracked MCP apply_migration calls, per
-- supabase/migrations/README.md's documented drift). scripts/guards/
-- guard-tenant-rls.mjs does a static-text scan over tracked .sql files,
-- so untracked-but-live DDL is invisible to it — which is exactly how
-- deal_voice_sessions's broken RLS policy went uncaught. Recording the
-- (already-true) facts here as idempotent statements closes that blind
-- spot for CI without touching live state.

alter table public.deal_documents add column if not exists bank_id uuid;
alter table public.deal_documents enable row level security;

alter table public.deal_financial_facts add column if not exists bank_id uuid not null;
alter table public.deal_financial_facts enable row level security;

alter table public.deal_voice_sessions add column if not exists bank_id uuid;
alter table public.deal_voice_sessions enable row level security;
