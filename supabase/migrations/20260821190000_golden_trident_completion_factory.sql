begin;

-- Golden Trident Completion Factory
-- 1. Repairs tenant isolation for the full research evidence graph.
-- 2. Provides one transactional, idempotent QA commissioning operation.
-- 3. Enforces evidence-backed inferences at the database boundary.

alter table public.buddy_research_inferences
  drop constraint if exists buddy_research_inferences_input_fact_ids_nonempty;
alter table public.buddy_research_inferences
  add constraint buddy_research_inferences_input_fact_ids_nonempty
  check (cardinality(input_fact_ids) > 0) not valid;
alter table public.buddy_research_inferences
  validate constraint buddy_research_inferences_input_fact_ids_nonempty;

do $$
declare
  target_table text;
  policy_row record;
begin
  foreach target_table in array array[
    'buddy_research_missions',
    'buddy_research_sources',
    'buddy_research_facts',
    'buddy_research_inferences',
    'buddy_research_narratives',
    'buddy_research_quality_gates'
  ]
  loop
    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public' and tablename = target_table
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, target_table);
    end loop;
  end loop;
end
$$;

create policy research_missions_bank_members
on public.buddy_research_missions
for all to authenticated
using (
  exists (
    select 1 from public.bank_memberships membership
    where membership.bank_id = buddy_research_missions.bank_id
      and membership.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.platform_admins admin
    where admin.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.bank_memberships membership
    where membership.bank_id = buddy_research_missions.bank_id
      and membership.user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.platform_admins admin
    where admin.user_id = (select auth.uid())
  )
);

create policy research_sources_via_authorized_mission
on public.buddy_research_sources
for all to authenticated
using (
  exists (
    select 1
    from public.buddy_research_missions mission
    join public.bank_memberships membership on membership.bank_id = mission.bank_id
    where mission.id = buddy_research_sources.mission_id
      and membership.user_id = (select auth.uid())
  )
  or exists (select 1 from public.platform_admins admin where admin.user_id = (select auth.uid()))
)
with check (
  exists (
    select 1
    from public.buddy_research_missions mission
    join public.bank_memberships membership on membership.bank_id = mission.bank_id
    where mission.id = buddy_research_sources.mission_id
      and membership.user_id = (select auth.uid())
  )
  or exists (select 1 from public.platform_admins admin where admin.user_id = (select auth.uid()))
);

create policy research_facts_via_authorized_mission
on public.buddy_research_facts
for all to authenticated
using (
  exists (
    select 1 from public.buddy_research_missions mission
    join public.bank_memberships membership on membership.bank_id = mission.bank_id
    where mission.id = buddy_research_facts.mission_id
      and membership.user_id = (select auth.uid())
  )
  or exists (select 1 from public.platform_admins admin where admin.user_id = (select auth.uid()))
)
with check (
  exists (
    select 1 from public.buddy_research_missions mission
    join public.bank_memberships membership on membership.bank_id = mission.bank_id
    where mission.id = buddy_research_facts.mission_id
      and membership.user_id = (select auth.uid())
  )
  or exists (select 1 from public.platform_admins admin where admin.user_id = (select auth.uid()))
);

create policy research_inferences_via_authorized_mission
on public.buddy_research_inferences
for all to authenticated
using (
  exists (
    select 1 from public.buddy_research_missions mission
    join public.bank_memberships membership on membership.bank_id = mission.bank_id
    where mission.id = buddy_research_inferences.mission_id
      and membership.user_id = (select auth.uid())
  )
  or exists (select 1 from public.platform_admins admin where admin.user_id = (select auth.uid()))
)
with check (
  exists (
    select 1 from public.buddy_research_missions mission
    join public.bank_memberships membership on membership.bank_id = mission.bank_id
    where mission.id = buddy_research_inferences.mission_id
      and membership.user_id = (select auth.uid())
  )
  or exists (select 1 from public.platform_admins admin where admin.user_id = (select auth.uid()))
);

create policy research_narratives_via_authorized_mission
on public.buddy_research_narratives
for all to authenticated
using (
  exists (
    select 1 from public.buddy_research_missions mission
    join public.bank_memberships membership on membership.bank_id = mission.bank_id
    where mission.id = buddy_research_narratives.mission_id
      and membership.user_id = (select auth.uid())
  )
  or exists (select 1 from public.platform_admins admin where admin.user_id = (select auth.uid()))
)
with check (
  exists (
    select 1 from public.buddy_research_missions mission
    join public.bank_memberships membership on membership.bank_id = mission.bank_id
    where mission.id = buddy_research_narratives.mission_id
      and membership.user_id = (select auth.uid())
  )
  or exists (select 1 from public.platform_admins admin where admin.user_id = (select auth.uid()))
);

create policy research_quality_via_authorized_mission
on public.buddy_research_quality_gates
for all to authenticated
using (
  exists (
    select 1 from public.buddy_research_missions mission
    join public.bank_memberships membership on membership.bank_id = mission.bank_id
    where mission.id = buddy_research_quality_gates.mission_id
      and membership.user_id = (select auth.uid())
  )
  or exists (select 1 from public.platform_admins admin where admin.user_id = (select auth.uid()))
)
with check (
  exists (
    select 1 from public.buddy_research_missions mission
    join public.bank_memberships membership on membership.bank_id = mission.bank_id
    where mission.id = buddy_research_quality_gates.mission_id
      and membership.user_id = (select auth.uid())
  )
  or exists (select 1 from public.platform_admins admin where admin.user_id = (select auth.uid()))
);

create or replace function public.commission_golden_trident_qa_research(
  p_deal_id uuid,
  p_bank_id uuid,
  p_run_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mission_id uuid;
  source_geo uuid;
  source_labor uuid;
  source_industry uuid;
  fact_population uuid;
  fact_income uuid;
  fact_growth uuid;
  fact_employment uuid;
  fact_location uuid;
begin
  if p_run_key is null or length(trim(p_run_key)) < 8 then
    raise exception 'invalid_golden_trident_run_key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_deal_id::text || ':' || p_run_key, 0));

  if not exists (
    select 1 from public.deals
    where id = p_deal_id and bank_id = p_bank_id and is_test = true
  ) then
    raise exception 'golden_trident_qa_deal_not_found';
  end if;

  select id into v_mission_id
  from public.buddy_research_missions
  where deal_id = p_deal_id and run_key = p_run_key
  order by created_at desc
  limit 1;

  if v_mission_id is not null and exists (
    select 1
    from public.buddy_research_narratives narrative
    join public.buddy_research_quality_gates gate on gate.mission_id = v_mission_id
    where narrative.mission_id = v_mission_id
      and gate.gate_passed = true
      and (select count(*) from public.buddy_research_sources where mission_id = v_mission_id) >= 3
      and (select count(*) from public.buddy_research_facts where mission_id = v_mission_id) >= 5
      and (select count(*) from public.buddy_research_inferences where mission_id = v_mission_id) >= 1
  ) then
    return v_mission_id;
  end if;

  if v_mission_id is not null then
    delete from public.buddy_research_missions where id = v_mission_id;
  end if;

  insert into public.buddy_research_missions (
    deal_id, bank_id, mission_type, subject, depth, status,
    completed_at, correlation_id, run_key
  ) values (
    p_deal_id, p_bank_id, 'market_demand',
    jsonb_build_object(
      'naics_code', '332710',
      'geography', 'Fort Worth, Texas',
      'keywords', jsonb_build_array('precision manufacturing', 'aerospace', 'industrial real estate'),
      'synthetic_qa', true
    ),
    'committee', 'complete', now(), p_run_key, p_run_key
  ) returning id into v_mission_id;

  insert into public.buddy_research_sources (
    mission_id, source_class, source_name, source_url, raw_content,
    content_type, checksum, http_status
  ) values
  (
    v_mission_id, 'geography', 'Synthetic QA Census profile',
    'https://qa.invalid/golden-trident/fort-worth-demographics',
    '{"population":978000,"median_household_income":79000,"population_trend":"growing","synthetic_qa":true}'::jsonb,
    'application/json',
    encode(digest('golden-trident:demographics:978000:79000', 'sha256'), 'hex'), 200
  ) returning id into source_geo;

  insert into public.buddy_research_sources (
    mission_id, source_class, source_name, source_url, raw_content,
    content_type, checksum, http_status
  ) values (
    v_mission_id, 'government', 'Synthetic QA labor profile',
    'https://qa.invalid/golden-trident/fort-worth-labor',
    '{"unemployment_rate":4.1,"skilled_labor_competition":"principal location risk","synthetic_qa":true}'::jsonb,
    'application/json',
    encode(digest('golden-trident:labor:4.1:competition', 'sha256'), 'hex'), 200
  ) returning id into source_labor;

  insert into public.buddy_research_sources (
    mission_id, source_class, source_name, source_url, raw_content,
    content_type, checksum, http_status
  ) values (
    v_mission_id, 'industry', 'Synthetic QA manufacturing outlook',
    'https://qa.invalid/golden-trident/precision-manufacturing',
    '{"market_growth_rate":3.2,"outlook":"stable-to-growing","industrial_real_estate":"adequate","synthetic_qa":true}'::jsonb,
    'application/json',
    encode(digest('golden-trident:industry:3.2:stable-growing:adequate', 'sha256'), 'hex'), 200
  ) returning id into source_industry;

  insert into public.buddy_research_facts
    (mission_id, source_id, fact_type, value, confidence, extracted_by, extraction_path, as_of_date)
  values
    (v_mission_id, source_geo, 'population', '{"count":978000,"geography":"Fort Worth, Texas"}', 1, 'rule', '$.population', current_date),
    (v_mission_id, source_geo, 'median_income', '{"amount":79000,"currency":"USD","geography":"Fort Worth, Texas"}', 1, 'rule', '$.median_household_income', current_date),
    (v_mission_id, source_industry, 'market_growth_rate', '{"percent":3.2,"scope":"Fort Worth precision manufacturing"}', 1, 'rule', '$.market_growth_rate', current_date),
    (v_mission_id, source_labor, 'other', '{"metric":"unemployment_rate","percent":4.1}', 1, 'rule', '$.unemployment_rate', current_date),
    (v_mission_id, source_industry, 'other', '{"metric":"industrial_real_estate","availability":"adequate"}', 1, 'rule', '$.industrial_real_estate', current_date)
;

  select id into fact_population from public.buddy_research_facts where mission_id = v_mission_id and fact_type = 'population' limit 1;
  select id into fact_income from public.buddy_research_facts where mission_id = v_mission_id and fact_type = 'median_income' limit 1;
  select id into fact_growth from public.buddy_research_facts where mission_id = v_mission_id and fact_type = 'market_growth_rate' limit 1;
  select id into fact_employment from public.buddy_research_facts where mission_id = v_mission_id and value->>'metric' = 'unemployment_rate' limit 1;
  select id into fact_location from public.buddy_research_facts where mission_id = v_mission_id and value->>'metric' = 'industrial_real_estate' limit 1;

  insert into public.buddy_research_inferences (
    mission_id, inference_type, conclusion, input_fact_ids, confidence, reasoning
  ) values (
    v_mission_id, 'growth_trajectory',
    'Fort Worth precision manufacturing conditions are stable-to-growing; industrial real estate is adequate and skilled-labor competition is the principal location risk.',
    array[fact_population, fact_income, fact_growth, fact_employment, fact_location],
    0.95,
    'Synthetic QA conclusion derived exclusively from the five cited fixture facts.'
  );

  insert into public.buddy_research_narratives (mission_id, version, sections)
  values (
    v_mission_id, 1,
    jsonb_build_array(
      jsonb_build_object(
        'title', 'Market demand',
        'sentences', jsonb_build_array(
          jsonb_build_object(
            'text', 'Fort Worth has a synthetic QA population of approximately 978,000 and median household income of approximately $79,000.',
            'citations', jsonb_build_array(
              jsonb_build_object('type','fact','id',fact_population),
              jsonb_build_object('type','fact','id',fact_income)
            )
          )
        )
      ),
      jsonb_build_object(
        'title', 'Growth trajectory',
        'sentences', jsonb_build_array(
          jsonb_build_object(
            'text', 'The synthetic QA precision-manufacturing outlook is stable-to-growing with a 3.2% market growth rate.',
            'citations', jsonb_build_array(jsonb_build_object('type','fact','id',fact_growth))
          )
        )
      ),
      jsonb_build_object(
        'title', 'Location suitability',
        'sentences', jsonb_build_array(
          jsonb_build_object(
            'text', 'Synthetic QA unemployment is 4.1%; industrial real estate is adequate, while skilled-labor competition remains the principal location risk.',
            'citations', jsonb_build_array(
              jsonb_build_object('type','fact','id',fact_employment),
              jsonb_build_object('type','fact','id',fact_location)
            )
          )
        )
      )
    )
  );

  insert into public.buddy_research_quality_gates (
    mission_id, deal_id, trust_grade, gate_passed, quality_score,
    entity_lock_check, entity_confidence,
    thread_coverage_check, threads_succeeded, threads_failed,
    source_diversity_check, source_count, primary_source_count, secondary_source_count,
    management_validation_check, litigation_source_check, synthesis_check,
    contradictions_found, underwriting_questions_found, gate_failures,
    section_source_statuses, contradiction_checklist, evidence_quality,
    preliminary_eligible, committee_eligible, preliminary_basis, committee_blockers
  ) values (
    v_mission_id, p_deal_id, 'A', true, 100,
    'pass', 1,
    'pass', 3, 0,
    'pass', 3, 2, 1,
    'not_applicable', 'not_applicable', 'pass',
    0, 1, '[]'::jsonb,
    jsonb_build_array(
      jsonb_build_object('section','Market demand','status','supported'),
      jsonb_build_object('section','Growth trajectory','status','supported'),
      jsonb_build_object('section','Location suitability','status','supported')
    ),
    '[]'::jsonb,
    jsonb_build_object('synthetic_qa',true,'citation_coverage',1,'fact_count',5),
    true, true,
    'Governed synthetic QA fixture with a complete source-to-narrative evidence chain.',
    '[]'::jsonb
  );

  return v_mission_id;
end
$$;

revoke all on function public.commission_golden_trident_qa_research(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.commission_golden_trident_qa_research(uuid, uuid, text)
  to service_role;

comment on function public.commission_golden_trident_qa_research(uuid, uuid, text)
is 'Service-role-only transactional QA research commissioning for Golden Trident.';

commit;

notify pgrst, 'reload schema';
