-- ============================================================================
-- Identity Metrics Views — Layer 2 v1.0
--
-- Derived from match.* events in deal_events.
-- Measures entity resolution coverage and ambiguity hotspots.
-- Read-only. No authority tables, no counters.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- VIEW 1: identity_resolution_coverage_v1
--
-- Per-doc-type entity resolution rate from match.* events.
-- Coverage = resolved_count / total_events.
-- Only includes events that carry entity_graph_version (instrumented events).
-- ---------------------------------------------------------------------------

create or replace view identity_resolution_coverage_v1 as
select
  payload->'meta'->>'effective_doc_type'        as doc_type,
  payload->'meta'->>'engine_version'             as engine_version,
  count(*)                                        as total_events,
  count(*) filter (
    where payload->'meta'->>'resolved_entity_id' is not null
  )                                               as resolved_count,
  round(
    count(*) filter (
      where payload->'meta'->>'resolved_entity_id' is not null
    )::numeric / nullif(count(*), 0),
    4
  )                                               as resolution_rate
from deal_events
where kind like 'match.%'
  and payload->'meta'->>'entity_graph_version' is not null
group by 1, 2
order by resolution_rate desc nulls last;


-- ---------------------------------------------------------------------------
-- VIEW 2: identity_ambiguity_hotspots_v1
--
-- Doc types with high ambiguous entity resolution rate.
-- Ambiguous = multiple candidates matched at same tier (engine cannot choose).
-- Minimum threshold: total_events > 5.
-- Ordered by ambiguity_rate DESC (worst first).
-- ---------------------------------------------------------------------------

create or replace view identity_ambiguity_hotspots_v1 as
select
  payload->'meta'->>'effective_doc_type'          as doc_type,
  count(*)                                          as total_events,
  count(*) filter (
    where (payload->'meta'->>'entity_ambiguous')::boolean is true
  )                                                 as ambiguous_count,
  round(
    count(*) filter (
      where (payload->'meta'->>'entity_ambiguous')::boolean is true
    )::numeric / nullif(count(*), 0),
    4
  )                                                 as ambiguity_rate
from deal_events
where kind like 'match.%'
  and payload->'meta'->>'entity_graph_version' is not null
group by 1
having count(*) > 5
order by ambiguity_rate desc nulls last;
