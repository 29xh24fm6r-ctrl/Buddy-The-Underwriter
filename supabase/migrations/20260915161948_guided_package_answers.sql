-- One transaction for the canonical form field, explicit confirmation and
-- conversation mirror. Callable only by the existing authenticated server path.
CREATE OR REPLACE FUNCTION public.save_guided_package_answer(
 p_deal_id uuid, p_bank_id uuid, p_question_id text, p_owner_id uuid,
 p_table text, p_column text, p_fact_path text, p_value jsonb,
 p_expected jsonb, p_source text, p_character_key text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
 v_deal public.deals; v_session public.borrower_concierge_sessions;
 v_id uuid; v_current jsonb; v_confirmed jsonb; v_extracted jsonb;
 v_scope text; v_key text; v_owner public.ownership_entities;
 v_array jsonb; v_index integer; v_owner_fact jsonb; v_old jsonb;
BEGIN
 SELECT * INTO v_deal FROM public.deals WHERE id=p_deal_id AND bank_id=p_bank_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Application unavailable'; END IF;
 IF p_source NOT IN ('text','voice') OR length(p_question_id)>200 OR octet_length(p_value::text)>50000 THEN RAISE EXCEPTION 'Invalid answer'; END IF;
 SELECT * INTO v_session FROM public.borrower_concierge_sessions WHERE deal_id=p_deal_id FOR UPDATE;
 IF NOT FOUND THEN
   INSERT INTO public.borrower_concierge_sessions(deal_id,bank_id,extracted_facts,confirmed_facts)
   VALUES(p_deal_id,p_bank_id,'{}','{}') RETURNING * INTO v_session;
 END IF;
 v_confirmed := coalesce(v_session.confirmed_facts,'{}');
 v_extracted := coalesce(v_session.extracted_facts,'{}');
 IF p_table IS NULL THEN
   IF p_question_id !~ '^[A-P][0-9]{2}$' OR p_owner_id IS NOT NULL THEN RAISE EXCEPTION 'Unknown package question'; END IF;
   v_current := v_confirmed #> ARRAY['package_answers',p_question_id,'value'];
 ELSE
   -- Server mapping is checked again in SQL; clients cannot choose arbitrary columns.
   IF NOT EXISTS (SELECT 1 FROM (VALUES
     ('loan.sba_program','deal_loan_requests','sba_program'),
     ('loan.agent_used','deal_loan_requests','agent_used'),
     ('loan.seller_note_equity_portion','deal_loan_requests','seller_note_equity_portion'),
     ('business.legal_name','borrowers','legal_name'),
     ('business.dba','borrowers','dba'),
     ('business.ein','borrowers','ein'),
     ('business.address_street','borrowers','address_line1'),
     ('business.address_city','borrowers','city'),
     ('business.address_state','borrowers','state'),
     ('business.address_zip','borrowers','zip'),
     ('business.phone','borrowers','phone'),
     ('business.entity_type','borrowers','entity_type'),
     ('business.naics','borrowers','naics_code'),
     ('business.employee_count','borrowers','employee_count'),
     ('business.year_founded','borrowers','year_founded'),
     ('business.has_pending_sba_application','borrowers','has_pending_sba_application'),
     ('business.has_bankruptcy_history','borrowers','has_bankruptcy_history'),
     ('business.has_pending_lawsuits','borrowers','has_pending_lawsuits'),
     ('business.is_engaged_in_lobbying','borrowers','is_engaged_in_lobbying'),
     ('business.duns_number','borrowers','duns_number'),
     ('business.website','borrowers','website'),
     ('business.contact_name','borrowers','contact_name'),
     ('business.contact_email','borrowers','contact_email'),
     ('business.type_of_business','borrowers','naics_description'),
     ('business.has_affiliates','borrowers','has_affiliates'),
     ('business.obtained_direct_or_guaranteed_loan','borrowers','obtained_direct_or_guaranteed_government_loan'),
     ('business.prior_application_submitted','borrowers','prior_project_application_submitted'),
     ('business.prior_cdc_lender_name_and_program','borrowers','prior_project_cdc_lender_name_and_program'),
     ('business.unique_entity_id','borrowers','unique_entity_id'),
     ('business.special_ownership_type','borrowers','special_ownership_type'),
     ('business.special_ownership_type_other','borrowers','special_ownership_type_other'),
     ('business.project_address_street','borrowers','project_address_street'),
     ('owner.full_name','ownership_entities','display_name'),
     ('owner.ownership_pct','ownership_entities','ownership_pct'),
     ('owner.title','ownership_entities','title'),
     ('owner.ssn_last4','ownership_entities','tax_id_last4'),
     ('owner.date_of_birth','ownership_entities','date_of_birth'),
     ('owner.place_of_birth','ownership_entities','place_of_birth'),
     ('owner.citizenship_status','ownership_entities','citizenship_status'),
     ('owner.principal_residence_in_us','ownership_entities','principal_residence_in_us'),
     ('owner.alien_registration_number','ownership_entities','alien_registration_number'),
     ('owner.home_address_street','ownership_entities','home_address_street'),
     ('owner.home_address_city','ownership_entities','home_address_city'),
     ('owner.home_address_state','ownership_entities','home_address_state'),
     ('owner.home_address_zip','ownership_entities','home_address_zip'),
     ('owner.home_phone','ownership_entities','home_phone'),
     ('owner.business_phone','ownership_entities','business_phone'),
     ('owner.is_us_government_employee','ownership_entities','is_us_government_employee'),
     ('owner.has_other_government_employment','ownership_entities','has_other_government_employment'),
     ('owner.arrested_or_charged_6mo','ownership_entities','arrested_or_charged_6mo'),
     ('owner.convicted_or_pleaded','ownership_entities','convicted_or_pleaded'),
     ('owner.pending_criminal_charges','ownership_entities','pending_criminal_charges'),
     ('owner.subject_to_indictment','ownership_entities','subject_to_indictment'),
     ('owner.on_parole_or_probation','ownership_entities','on_parole_or_probation'),
     ('owner.former_names_and_dates_used','ownership_entities','former_names_and_dates_used'),
     ('owner.country_of_citizenship','ownership_entities','country_of_citizenship'),
     ('owner.sba_loan_entity_interest','ownership_entities','sba_loan_entity_interest'),
     ('owner.sba_loan_entity_interest_details','ownership_entities','sba_loan_entity_interest_details'),
     ('owner.convicted_diversion_or_parole','ownership_entities','convicted_diversion_or_parole'),
     ('owner.suspended_debarred_ineligible','ownership_entities','suspended_debarred_ineligible'),
     ('owner.veteran_status','ownership_entities','veteran_status'),
     ('owner.sex','ownership_entities','sex'),
     ('owner.race','ownership_entities','race'),
     ('owner.ethnicity','ownership_entities','ethnicity'),
     ('owner.debarred_ineligible_or_bankrupt','ownership_entities','debarred_ineligible_or_bankrupt'),
     ('owner.defaulted_or_delinquent_gov_loan','ownership_entities','defaulted_or_delinquent_gov_loan'),
     ('owner.owns_other_business','ownership_entities','owns_other_business'),
     ('owner.incarcerated_or_indicted_financial_crime','ownership_entities','incarcerated_or_indicted_financial_crime'),
     ('owner.has_export_sales','ownership_entities','has_export_sales'),
     ('owner.fee_paid_to_lender_or_broker','ownership_entities','fee_paid_to_lender_or_broker'),
     ('owner.restricted_revenue_source','ownership_entities','restricted_revenue_source'),
     ('owner.sba_employee_conflict','ownership_entities','sba_employee_conflict'),
     ('owner.former_sba_employee_conflict','ownership_entities','former_sba_employee_conflict'),
     ('owner.congress_legislative_judicial_conflict','ownership_entities','congress_legislative_judicial_conflict'),
     ('owner.federal_employee_or_military_conflict','ownership_entities','federal_employee_or_military_conflict'),
     ('owner.score_or_advisory_council_member','ownership_entities','score_or_advisory_council_member'),
     ('owner.legal_action_pending','ownership_entities','legal_action_pending'),
     ('owner.riot_related_conviction_past_year','ownership_entities','riot_related_conviction_past_year'),
     ('owner.delinquent_child_support_60days','ownership_entities','delinquent_child_support_60days'),
     ('owner.prior_address_street','ownership_entities','prior_address_street'),
     ('owner.export_sales_total','ownership_entities','export_sales_total'),
     ('owner.export_country_1','ownership_entities','export_country_1'),
     ('owner.all_other_names_used','ownership_entities','all_other_names_used'),
     ('owner.residence_history_5yr','ownership_entities','residence_history_5yr'),
     ('owner.arrest_explanation','ownership_entities','arrest_explanation'),
     ('owner.conviction_explanation','ownership_entities','conviction_explanation'),
     ('owner.indictment_explanation','ownership_entities','indictment_explanation'),
     ('owner.parole_explanation','ownership_entities','parole_explanation'),
     ('owner.has_spouse','ownership_entities','has_spouse'),
     ('owner.spouse_full_name','ownership_entities','spouse_full_name'),
     ('entity.legal_name','ownership_entities','display_name'),
     ('entity.ein','ownership_entities','entity_ein'),
     ('entity.entity_type','ownership_entities','entity_type'),
     ('entity.address_street','ownership_entities','entity_address_street'),
     ('entity.address_city','ownership_entities','entity_address_city'),
     ('entity.address_state','ownership_entities','entity_address_state'),
     ('entity.address_zip','ownership_entities','entity_address_zip'),
     ('loan.amount_requested','deal_loan_requests','requested_amount'),
     ('loan.use_of_proceeds','deal_loan_requests','use_of_proceeds'),
     ('loan.loan_purpose','deal_loan_requests','loan_purpose'),
     ('loan.jobs_to_be_created','deal_loan_requests','jobs_created_count'),
     ('loan.jobs_to_be_retained','deal_loan_requests','jobs_retained_count'),
     ('loan.is_eligible_passive_company','deals','is_eligible_passive_company'),
     ('loan.oc_legal_name','deals','operating_company_legal_name'),
     ('loan.oc_address','deals','operating_company_address'),
     ('loan.oc_dba','deals','operating_company_dba'),
     ('loan.oc_legal_structure','deals','operating_company_legal_structure'),
     ('loan.oc_tax_id','deals','operating_company_tax_id'),
     ('loan.oc_duns_number','deals','operating_company_duns_number'),
     ('loan.oc_contact_name','deals','operating_company_contact_name'),
     ('loan.oc_email','deals','operating_company_email'),
     ('loan.oc_phone','deals','operating_company_phone'),
     ('loan.oc_website','deals','operating_company_website'),
     ('loan.standby_creditor_name','deal_loan_requests','standby_creditor_name'),
     ('loan.standby_creditor_address','deal_loan_requests','standby_creditor_address'),
     ('loan.subordination_terms_acknowledged','deal_loan_requests','subordination_terms_acknowledged'),
     ('loan.note_date','deal_loan_requests','note_date'),
     ('loan.note_interest_rate','deal_loan_requests','note_interest_rate'),
     ('loan.standby_note_interest_amount','deal_loan_requests','standby_note_interest_amount'),
     ('loan.standby_agreement_option','deal_loan_requests','standby_agreement_option'),
     ('loan.contractor_name','deal_loan_requests','contractor_name'),
     ('loan.contractor_address','deal_loan_requests','contractor_address'),
     ('loan.contractor_phone','deal_loan_requests','contractor_phone'),
     ('loan.contractor_authorized_official','deal_loan_requests','contractor_authorized_official'),
     ('loan.compliance_certification_acknowledged','deal_loan_requests','compliance_certification_acknowledged'),
     ('loan.limited_guarantee_cap_amount','deal_loan_requests','limited_guarantee_cap_amount'),
     ('loan.tax_years','deal_loan_requests','tax_years'),
     ('pfs.asset_cash_on_hand_and_in_banks','borrower_applicant_financials','liquid_assets'),
     ('pfs.asset_savings_accounts','borrower_applicant_financials','asset_savings_accounts'),
     ('pfs.asset_ira_retirement','borrower_applicant_financials','asset_ira_retirement'),
     ('pfs.asset_accounts_notes_receivable','borrower_applicant_financials','asset_accounts_notes_receivable'),
     ('pfs.asset_life_insurance_cash_surrender_value','borrower_applicant_financials','asset_life_insurance_csv'),
     ('pfs.asset_stocks_bonds','borrower_applicant_financials','asset_stocks_bonds'),
     ('pfs.asset_real_estate','borrower_applicant_financials','asset_real_estate'),
     ('pfs.asset_automobile','borrower_applicant_financials','asset_automobile'),
     ('pfs.asset_other_personal_property','borrower_applicant_financials','asset_other_personal_property'),
     ('pfs.asset_other','borrower_applicant_financials','asset_other'),
     ('pfs.liability_accounts_payable','borrower_applicant_financials','liability_accounts_payable'),
     ('pfs.liability_notes_payable_banks_others','borrower_applicant_financials','liability_notes_payable_banks_others'),
     ('pfs.liability_installment_auto','borrower_applicant_financials','liability_installment_auto'),
     ('pfs.liability_installment_other','borrower_applicant_financials','liability_installment_other'),
     ('pfs.liability_loan_on_life_insurance','borrower_applicant_financials','liability_loan_on_life_insurance'),
     ('pfs.liability_mortgages_on_real_estate','borrower_applicant_financials','liability_mortgages_on_real_estate'),
     ('pfs.liability_unpaid_taxes','borrower_applicant_financials','liability_unpaid_taxes'),
     ('pfs.liability_other','borrower_applicant_financials','liability_other'),
     ('pfs.net_worth','borrower_applicant_financials','net_worth'),
     ('pfs.contingent_as_endorser_or_comaker','borrower_applicant_financials','contingent_as_endorser_or_comaker'),
     ('pfs.contingent_legal_claims_judgments','borrower_applicant_financials','contingent_legal_claims_judgments'),
     ('pfs.contingent_provision_for_federal_income_tax','borrower_applicant_financials','contingent_provision_for_federal_income_tax'),
     ('pfs.contingent_other_special_debt','borrower_applicant_financials','contingent_other_special_debt'),
     ('pfs.income_salary','borrower_applicant_financials','income_salary'),
     ('pfs.income_net_investment','borrower_applicant_financials','income_net_investment'),
     ('pfs.income_real_estate','borrower_applicant_financials','income_real_estate'),
     ('pfs.income_other','borrower_applicant_financials','income_other'),
     ('pfs.income_other_description','borrower_applicant_financials','income_other_description'),
     ('pfs.other_personal_property_description','borrower_applicant_financials','other_personal_property_description'),
     ('pfs.unpaid_taxes_description','borrower_applicant_financials','unpaid_taxes_description'),
     ('pfs.other_liabilities_description','borrower_applicant_financials','other_liabilities_description'),
     ('pfs.life_insurance_description','borrower_applicant_financials','life_insurance_description'),
     ('pfs.real_estate_property_address','borrower_applicant_financials','real_estate_property_address'),
     ('pfs.real_estate_type_title','borrower_applicant_financials','real_estate_type_title'),
     ('pfs.real_estate_original_cost','borrower_applicant_financials','real_estate_original_cost'),
     ('pfs.real_estate_present_market_value','borrower_applicant_financials','real_estate_present_market_value'),
     ('pfs.real_estate_amount_of_mortgage','borrower_applicant_financials','real_estate_amount_of_mortgage')
   ) AS allowed(fact_path,table_name,column_name) WHERE fact_path=p_fact_path AND table_name=p_table AND column_name=p_column) THEN RAISE EXCEPTION 'Field is not borrower writable'; END IF;
   v_scope := split_part(p_fact_path,'.',1); v_key := split_part(p_fact_path,'.',2);
   IF v_scope IN ('owner','entity','pfs') THEN
     SELECT * INTO v_owner FROM public.ownership_entities WHERE id=p_owner_id AND deal_id=p_deal_id FOR UPDATE;
     IF NOT FOUND OR p_question_id <> p_fact_path || ':' || p_owner_id::text THEN RAISE EXCEPTION 'Owner unavailable'; END IF;
   ELSIF p_owner_id IS NOT NULL OR p_question_id <> p_fact_path THEN RAISE EXCEPTION 'Invalid question target'; END IF;
   IF p_table='deals' THEN v_id:=p_deal_id; v_current:=to_jsonb(v_deal)->p_column;
   ELSIF p_table='borrowers' THEN
     v_id := v_deal.borrower_id;
     IF v_id IS NULL THEN
       IF p_column <> 'legal_name' OR nullif(p_value #>> '{}','') IS NULL THEN RAISE EXCEPTION 'Save the business legal name first'; END IF;
       INSERT INTO public.borrowers(bank_id,legal_name) VALUES(p_bank_id,p_value #>> '{}') RETURNING id INTO v_id;
       UPDATE public.deals SET borrower_id=v_id WHERE id=p_deal_id;
       v_current := NULL;
     ELSE EXECUTE format('SELECT to_jsonb(t)->%L FROM public.borrowers t WHERE id=$1 FOR UPDATE',p_column) INTO v_current USING v_id;
     END IF;
   ELSIF p_table='ownership_entities' THEN
     v_id := p_owner_id; v_current := to_jsonb(v_owner)->p_column;
   ELSIF p_table='borrower_applicant_financials' THEN
     v_id := p_owner_id;
     EXECUTE format('SELECT to_jsonb(t)->%L FROM public.borrower_applicant_financials t WHERE applicant_id=$1 FOR UPDATE',p_column) INTO v_current USING v_id;
     INSERT INTO public.borrower_applicant_financials(applicant_id) VALUES(v_id) ON CONFLICT(applicant_id) DO NOTHING;
   ELSIF p_table='deal_loan_requests' THEN
     SELECT id INTO v_id FROM public.deal_loan_requests WHERE deal_id=p_deal_id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
     IF v_id IS NULL THEN
       INSERT INTO public.deal_loan_requests(deal_id,bank_id,product_type) VALUES(p_deal_id,p_bank_id,CASE WHEN v_session.program='504' THEN 'SBA_504' ELSE 'SBA_7A' END) RETURNING id INTO v_id;
     END IF;
     EXECUTE format('SELECT to_jsonb(t)->%L FROM public.deal_loan_requests t WHERE id=$1',p_column) INTO v_current USING v_id;
   ELSE RAISE EXCEPTION 'Field requires lender entry'; END IF;
 END IF;
 IF coalesce(v_current,'null'::jsonb) IS DISTINCT FROM coalesce(p_expected,'null'::jsonb) THEN RAISE EXCEPTION 'Answer changed; reload before saving'; END IF;
 IF p_table IS NOT NULL THEN
   EXECUTE format('UPDATE public.%I SET %I=(SELECT %I FROM jsonb_populate_record(NULL::public.%I,$1)) WHERE %I=$2',p_table,p_column,p_column,p_table,CASE WHEN p_table='borrower_applicant_financials' THEN 'applicant_id' ELSE 'id' END) USING jsonb_build_object(p_column,p_value),v_id;
   IF p_fact_path='loan.use_of_proceeds' THEN
     INSERT INTO public.deal_structured_field_confirmations(deal_id,bank_id,form_code,field_key,value,rationale,confidence,confirmed,generated_at,confirmed_at)
     VALUES(p_deal_id,p_bank_id,'1919','use_of_proceeds_categories',jsonb_build_object('categorized',p_value),'Borrower selected the categories and amounts','high',true,now(),now())
     ON CONFLICT(deal_id,form_code,field_key) DO UPDATE SET value=excluded.value,rationale=excluded.rationale,confidence=excluded.confidence,confirmed=true,confirmed_at=now();
   END IF;
   IF p_fact_path='loan.sba_program'  THEN UPDATE public.deal_loan_requests SET product_type=CASE WHEN p_value #>> '{}'='504' THEN 'SBA_504' ELSE 'SBA_7A' END WHERE id=v_id; UPDATE public.borrower_concierge_sessions SET program=CASE WHEN p_value #>> '{}'='504' THEN '504' ELSE '7a' END WHERE id=v_session.id; END IF;
   IF p_fact_path='loan.amount_requested' THEN UPDATE public.deals SET loan_amount=(p_value #>> '{}')::numeric WHERE id=p_deal_id; END IF;
   IF p_character_key IS NOT NULL THEN
     IF p_table<>'ownership_entities' OR jsonb_typeof(p_value)<>'boolean' THEN RAISE EXCEPTION 'Invalid confirmation'; END IF;
     INSERT INTO public.character_question_confirmations(deal_id,ownership_entity_id,field_key,answer,confirmed_at,confirmed_by)
     VALUES(p_deal_id,p_owner_id,p_character_key,(p_value #>> '{}')::boolean,now(),'borrower')
     ON CONFLICT(deal_id,ownership_entity_id,field_key) DO UPDATE SET answer=excluded.answer,confirmed_at=excluded.confirmed_at,confirmed_by=excluded.confirmed_by;
   END IF;
   -- Mirror only the submitted field; preserve unrelated text and voice facts.
   IF v_scope IN ('business','loan') THEN
     v_confirmed := jsonb_set(v_confirmed,ARRAY[v_scope],coalesce(v_confirmed->v_scope,'{}') || jsonb_build_object(v_key,p_value));
     v_extracted := jsonb_set(v_extracted,ARRAY[v_scope],coalesce(v_extracted->v_scope,'{}') || jsonb_build_object(v_key,p_value));
   ELSE
     v_scope := CASE WHEN v_scope='entity' THEN 'entities' ELSE 'owners' END;
     v_array := coalesce(v_extracted->v_scope,v_confirmed->v_scope,'[]');
     SELECT ordinality::integer-1,value INTO v_index,v_owner_fact FROM jsonb_array_elements(v_array) WITH ORDINALITY WHERE value->>'ownership_entity_id'=p_owner_id::text OR lower(value->>'full_name')=lower(v_owner.display_name) LIMIT 1;
     v_owner_fact := coalesce(v_owner_fact,'{}') || jsonb_build_object('ownership_entity_id',p_owner_id,'full_name',v_owner.display_name);
     IF split_part(p_fact_path,'.',1)='pfs' THEN v_owner_fact:=jsonb_set(v_owner_fact,'{pfs}',coalesce(v_owner_fact->'pfs','{}') || jsonb_build_object(v_key,p_value));
     ELSE v_owner_fact:=v_owner_fact || jsonb_build_object(v_key,p_value); END IF;
     IF v_index IS NULL THEN v_array:=v_array || jsonb_build_array(v_owner_fact); ELSE v_array:=jsonb_set(v_array,ARRAY[v_index::text],v_owner_fact); END IF;
     v_confirmed:=jsonb_set(v_confirmed,ARRAY[v_scope],v_array); v_extracted:=jsonb_set(v_extracted,ARRAY[v_scope],v_array);
   END IF;
 END IF;
 v_key := CASE WHEN p_table IS NULL THEN 'package_answers' ELSE 'guided_answers' END;
 v_old := v_confirmed #> ARRAY[v_key,p_question_id];
 v_confirmed := jsonb_set(v_confirmed,ARRAY[v_key],coalesce(v_confirmed->v_key,'{}') || jsonb_build_object(p_question_id,jsonb_build_object('value',p_value,'source',p_source,'saved_at',now(),'previous_value',v_current)));
 IF p_table IS NULL THEN v_extracted:=jsonb_set(v_extracted,ARRAY[v_key],v_confirmed->v_key); END IF;
 UPDATE public.borrower_concierge_sessions SET extracted_facts=v_extracted,confirmed_facts=v_confirmed,updated_at=clock_timestamp() WHERE id=v_session.id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_guided_package_answer(uuid,uuid,text,uuid,text,text,text,jsonb,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_guided_package_answer(uuid,uuid,text,uuid,text,text,text,jsonb,jsonb,text,text) TO service_role;

-- Labels describe the property; PDF slots are assigned at render time and
-- additional properties are included on continuation sheets.
ALTER TABLE public.borrower_pfs_real_estate DROP CONSTRAINT IF EXISTS borrower_pfs_real_estate_property_label_check;

CREATE OR REPLACE FUNCTION public.save_guided_pfs_row(p_deal_id uuid,p_bank_id uuid,p_owner_id uuid,p_table text,p_row_id uuid,p_values jsonb,p_delete boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_id uuid; v_owner uuid; v_columns text; v_values text;
BEGIN
 PERFORM 1 FROM public.deals WHERE id=p_deal_id AND bank_id=p_bank_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Application unavailable'; END IF;
 SELECT id INTO v_owner FROM public.ownership_entities WHERE id=p_owner_id AND deal_id=p_deal_id;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'Owner unavailable'; END IF;
 IF p_table NOT IN ('borrower_pfs_notes_payable','borrower_pfs_securities','borrower_pfs_real_estate') THEN RAISE EXCEPTION 'Invalid schedule'; END IF;
 IF p_row_id IS NOT NULL THEN
   EXECUTE format('SELECT id FROM public.%I WHERE id=$1 AND deal_id=$2 AND applicant_id=$3 FOR UPDATE',p_table) INTO v_id USING p_row_id,p_deal_id,p_owner_id;
   IF v_id IS NULL THEN RAISE EXCEPTION 'Schedule row unavailable'; END IF;
 END IF;
 IF p_delete THEN
   IF v_id IS NULL THEN RAISE EXCEPTION 'No row selected'; END IF;
   EXECUTE format('DELETE FROM public.%I WHERE id=$1',p_table) USING v_id;
   RETURN v_id;
 END IF;
 IF p_values ?| ARRAY['id','deal_id','applicant_id','created_at','updated_at'] THEN RAISE EXCEPTION 'Immutable schedule fields'; END IF;
 IF jsonb_typeof(p_values)<>'object' OR p_values='{}'::jsonb THEN RAISE EXCEPTION 'Empty schedule'; END IF;
 SELECT string_agg(format('%I',key),','),string_agg(format('r.%I',key),',') INTO v_columns,v_values FROM jsonb_object_keys(p_values) AS key;
 IF v_id IS NULL THEN
   EXECUTE format('INSERT INTO public.%I(deal_id,applicant_id,%s) SELECT $1,$2,%s FROM jsonb_populate_record(NULL::public.%I,$3) r RETURNING id',p_table,v_columns,v_values,p_table) INTO v_id USING p_deal_id,p_owner_id,p_values;
 ELSE
   EXECUTE format('UPDATE public.%I SET (%s)=(SELECT %s FROM jsonb_populate_record(NULL::public.%I,$1) r) WHERE id=$2',p_table,v_columns,v_values,p_table) USING p_values,v_id;
 END IF;
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_guided_pfs_row(uuid,uuid,uuid,text,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_guided_pfs_row(uuid,uuid,uuid,text,uuid,jsonb,boolean) TO service_role;

-- Restore the missing official asset without replacing an existing uploaded version.
INSERT INTO public.bank_document_templates(bank_id,template_key,name,version,file_path,mime_type,file_sha256,is_active,metadata)
SELECT NULL,'SBA_159','SBA Form 159 — Fee Disclosure and Compensation Agreement','2022-02-10','sba-templates/SBA_159.pdf','application/pdf','182731098edcba9beb1db04449ad5b6b95c899076a2b96612a22e689c1dfe398',true,
'{"source_url":"https://legacy.sba.gov/sites/default/files/2022-02/SBA%20Form%20159_2.10.22-508_0.pdf","field_count":47,"fill_strategy":"acroform"}'::jsonb
WHERE NOT EXISTS(SELECT 1 FROM public.bank_document_templates WHERE bank_id IS NULL AND template_key='SBA_159');

INSERT INTO public.bank_document_templates(bank_id,template_key,name,version,file_path,mime_type,file_sha256,is_active,metadata)
SELECT NULL,'SBA_722','SBA Form 722 — Equal Employment Opportunity Statement','2002-10','sba-templates/SBA_722.pdf','application/pdf','915e836b8f25d244205c0b469e19c9bc0b1faf9207b5b882d29b325ad32708c7',true,
'{"source_url":"https://legacy.sba.gov/sites/default/files/2022-07/forms_mis772_3-508.pdf","fill_strategy":"static_poster"}'::jsonb
WHERE NOT EXISTS(SELECT 1 FROM public.bank_document_templates WHERE bank_id IS NULL AND template_key='SBA_722');
