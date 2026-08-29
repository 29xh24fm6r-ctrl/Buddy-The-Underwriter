-- Clerk is Buddy's canonical identity provider. Research mission attribution must
-- therefore accept Clerk user IDs (for example, user_...) instead of requiring a
-- Supabase Auth UUID. Preserve any legacy UUID attribution as text.
alter table public.buddy_research_missions
  drop constraint if exists buddy_research_missions_created_by_fkey;

alter table public.buddy_research_missions
  alter column created_by type text
  using created_by::text;

comment on column public.buddy_research_missions.created_by is
  'Canonical actor identifier. Clerk user ID for interactive runs; legacy Supabase UUIDs are retained as text.';
