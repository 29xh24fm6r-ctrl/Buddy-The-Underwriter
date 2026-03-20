-- Fingerprint-grouped error summary for Buddy observer events.
-- Designed for Pulse Supabase (buddy_observer_events table).
-- Called by Pulse MCP tool: buddy.error_fingerprint_summary

create or replace function public.buddy_error_fingerprint_summary(
  p_env text,
  p_minutes int default 60,
  p_limit int default 10
)
returns table (
  fingerprint text,
  count int,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  stages text[],
  types text[],
  sample_messages text[],
  sample_deal_ids text[],
  sample_releases text[]
)
language sql
stable
as $$
  with recent as (
    select
      fingerprint,
      created_at,
      stage,
      type,
      message,
      deal_id,
      release
    from public.buddy_observer_events
    where env = p_env
      and created_at >= now() - make_interval(mins => p_minutes)
      and severity in ('error', 'fatal')
  ),
  agg as (
    select
      r.fingerprint,
      count(*)::int as count,
      min(r.created_at) as first_seen_at,
      max(r.created_at) as last_seen_at,
      array_remove(array_agg(distinct r.stage), null) as stages,
      array_agg(distinct r.type) as types,
      (select array_agg(m) from (
        select distinct r2.message as m
        from recent r2
        where r2.fingerprint = r.fingerprint
        order by m
        limit 3
      ) x) as sample_messages,
      (select array_agg(d) from (
        select distinct r3.deal_id as d
        from recent r3
        where r3.fingerprint = r.fingerprint
          and r3.deal_id is not null
        order by d
        limit 5
      ) y) as sample_deal_ids,
      (select array_agg(rel) from (
        select distinct r4.release as rel
        from recent r4
        where r4.fingerprint = r.fingerprint
          and r4.release is not null
        order by rel
        limit 5
      ) z) as sample_releases
    from recent r
    group by r.fingerprint
  )
  select *
  from agg
  order by count desc, last_seen_at desc
  limit p_limit;
$$;
