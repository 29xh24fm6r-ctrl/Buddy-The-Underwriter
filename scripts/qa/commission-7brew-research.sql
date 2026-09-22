-- Synthetic test INPUTS only. Never valid market evidence for an actual loan.
-- Scoped to the existing isolated QA 7 Brew deal, bank, business and geography.
-- No documents, scores, bundle outputs or borrower release gates are fabricated.
-- Numeric values below are illustrative test values, NOT Flowery Branch statistics.
-- Safe to repeat after success; incomplete prior runs fail without deleting evidence.
begin;
do $qa$
declare
  p_deal_id constant uuid := 'e6c35197-349b-402d-be4c-49cbc87e2f7e';
  p_bank_id constant uuid := 'd8a4cf3a-7575-45df-9926-f31eaed99f3c';
  p_run_key constant text := '7brew-franchise-qa-context-v1';
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
    select 1 from public.deals d
    join public.borrowers b on b.id = d.borrower_id
    where d.id = p_deal_id and d.bank_id = p_bank_id and d.is_test = true
      and b.legal_name = 'QA 7 Brew Franchise Test LLC'
      and b.city = 'Flowery Branch' and b.state = 'GA' 
  ) then
    raise exception 'golden_trident_qa_deal_not_found';
  end if;

  -- Do not mutate evidence beneath an active immutable package snapshot.
  perform 1 from public.deals where id = p_deal_id for update;
  if exists (select 1 from public.buddy_trident_bundles
    where deal_id = p_deal_id and status in ('pending', 'running')
      and lease_expires_at > now()) then
    raise exception 'qa_package_run_active';
  end if;

  update public.deals
  set test_suite = coalesce(test_suite, 'golden-trident'),
      test_run_id = coalesce(test_run_id, p_run_key)
  where id = p_deal_id and bank_id = p_bank_id and is_test = true;

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
      and gate.trust_grade = 'committee_grade'
      and (select count(*) from public.buddy_research_sources where mission_id = v_mission_id) >= 3
      and (select count(*) from public.buddy_research_facts where mission_id = v_mission_id) >= 5
      and (select count(*) from public.buddy_research_inferences where mission_id = v_mission_id) >= 1
  ) then
    return;
  end if;

  if v_mission_id is not null then
    raise exception 'qa_research_incomplete_existing_run';
  end if;

  insert into public.buddy_research_missions (
    deal_id, bank_id, mission_type, subject, depth, status,
    completed_at, correlation_id, run_key
  ) values (
    p_deal_id, p_bank_id, 'market_demand',
    jsonb_build_object(
      'naics_code', '722515',
      'geography', 'Flowery Branch, Georgia',
      'keywords', jsonb_build_array('drive-through coffee', 'quick-service beverages', 'retail site availability'),
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
    'https://qa.invalid/golden-trident/flowery-branch-demographics',
    '{"population":48000,"median_household_income":79000,"population_trend":"growing","synthetic_qa":true}'::jsonb,
    'application/json',
    pg_catalog.encode(extensions.digest('golden-trident:demographics:48000:79000', 'sha256'), 'hex'), 200
  ) returning id into source_geo;

  insert into public.buddy_research_sources (
    mission_id, source_class, source_name, source_url, raw_content,
    content_type, checksum, http_status
  ) values (
    v_mission_id, 'government', 'Synthetic QA labor profile',
    'https://qa.invalid/golden-trident/flowery-branch-labor',
    '{"unemployment_rate":4.1,"skilled_labor_competition":"principal location risk","synthetic_qa":true}'::jsonb,
    'application/json',
    pg_catalog.encode(extensions.digest('golden-trident:labor:4.1:competition', 'sha256'), 'hex'), 200
  ) returning id into source_labor;

  insert into public.buddy_research_sources (
    mission_id, source_class, source_name, source_url, raw_content,
    content_type, checksum, http_status
  ) values (
    v_mission_id, 'industry', 'Synthetic QA coffee-market outlook',
    'https://qa.invalid/golden-trident/drive-through-coffee',
    '{"market_growth_rate":3.2,"outlook":"stable-to-growing","retail_site_availability":"adequate","synthetic_qa":true}'::jsonb,
    'application/json',
    pg_catalog.encode(extensions.digest('golden-trident:industry:3.2:stable-growing:adequate', 'sha256'), 'hex'), 200
  ) returning id into source_industry;

  insert into public.buddy_research_facts
    (mission_id, source_id, fact_type, value, confidence, extracted_by, extraction_path, as_of_date)
  values
    (v_mission_id, source_geo, 'population', '{"count":48000,"geography":"Flowery Branch, Georgia"}', 1, 'rule', '$.population', current_date),
    (v_mission_id, source_geo, 'median_income', '{"amount":79000,"currency":"USD","geography":"Flowery Branch, Georgia"}', 1, 'rule', '$.median_household_income', current_date),
    (v_mission_id, source_industry, 'market_growth_rate', '{"percent":3.2,"scope":"Flowery Branch drive-through coffee"}', 1, 'rule', '$.market_growth_rate', current_date),
    (v_mission_id, source_labor, 'other', '{"metric":"unemployment_rate","percent":4.1}', 1, 'rule', '$.unemployment_rate', current_date),
    (v_mission_id, source_industry, 'other', '{"metric":"retail_site_availability","availability":"adequate"}', 1, 'rule', '$.retail_site_availability', current_date)
;

  select id into fact_population from public.buddy_research_facts where mission_id = v_mission_id and fact_type = 'population' limit 1;
  select id into fact_income from public.buddy_research_facts where mission_id = v_mission_id and fact_type = 'median_income' limit 1;
  select id into fact_growth from public.buddy_research_facts where mission_id = v_mission_id and fact_type = 'market_growth_rate' limit 1;
  select id into fact_employment from public.buddy_research_facts where mission_id = v_mission_id and value->>'metric' = 'unemployment_rate' limit 1;
  select id into fact_location from public.buddy_research_facts where mission_id = v_mission_id and value->>'metric' = 'retail_site_availability' limit 1;

  insert into public.buddy_research_inferences (
    mission_id, inference_type, conclusion, input_fact_ids, confidence, reasoning
  ) values (
    v_mission_id, 'growth_trajectory',
    'Flowery Branch drive-through coffee conditions are stable-to-growing; retail site availability is adequate and staffing competition is the principal location risk.',
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
            'text', 'Flowery Branch has a synthetic QA population of approximately 48,000 and median household income of approximately $79,000.',
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
            'text', 'The synthetic QA drive-through-coffee outlook is stable-to-growing with a 3.2% market growth rate.',
            'citations', jsonb_build_array(jsonb_build_object('type','fact','id',fact_growth))
          )
        )
      ),
      jsonb_build_object(
        'title', 'Location suitability',
        'sentences', jsonb_build_array(
          jsonb_build_object(
            'text', 'Synthetic QA unemployment is 4.1%; retail site availability is adequate, while staffing competition remains the principal location risk.',
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
    v_mission_id, p_deal_id, 'committee_grade', true, 100,
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

  return;
end
$qa$;
commit;
