begin;

-- Seal creation and borrower unsealing are lifecycle transitions, not three
-- unrelated writes. Keep the package, listing, and deal status in one
-- transaction so a constraint, trigger, or zero-row update rolls back all of
-- them together.

create or replace function public.create_buddy_seal_listing(
  p_deal_id uuid,
  p_bank_id uuid,
  p_sealed_snapshot jsonb,
  p_final_business_plan_path text,
  p_final_projections_path text,
  p_final_feasibility_path text,
  p_kfs jsonb,
  p_kfs_redaction_version text,
  p_score integer,
  p_band text,
  p_rate_card_tier text,
  p_published_rate_bps integer,
  p_sba_program text,
  p_loan_amount numeric,
  p_term_months integer,
  p_matched_lender_bank_ids uuid[],
  p_preview_opens_at timestamptz,
  p_claim_opens_at timestamptz,
  p_claim_closes_at timestamptz
)
returns table(sealed_package_id uuid, listing_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal_id uuid;
  v_sealed_package_id uuid;
  v_listing_id uuid;
  v_deal_status text;
begin
  -- Coordinate with Golden Trident publication and serialize every seal
  -- attempt for this deal. The deal row lock also prevents competing lifecycle
  -- updates from proving success against stale state.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_deal_id::text || ':final', 0)
  );

  select d.id
    into v_deal_id
    from public.deals d
   where d.id = p_deal_id
     and d.bank_id = p_bank_id
   for update;

  if not found then
    raise exception 'seal_deal_not_found_or_tenant_mismatch';
  end if;

  if p_sealed_snapshot is null
     or p_final_business_plan_path is null
     or p_final_projections_path is null
     or p_final_feasibility_path is null then
    raise exception 'seal_snapshot_binding_incomplete';
  end if;

  -- Re-prove the certified final bundle frozen into this snapshot immediately
  -- before creating the active seal. This prevents a stale in-memory snapshot
  -- from becoming marketplace evidence.
  perform 1
    from public.buddy_trident_bundles bundle
   where bundle.id::text = p_sealed_snapshot #>> '{tridentFinal,bundleId}'
     and bundle.deal_id = p_deal_id
     and bundle.bank_id = p_bank_id
     and bundle.mode = 'final'
     and bundle.status = 'succeeded'
     and bundle.superseded_at is null
     and bundle.business_plan_pdf_path = p_final_business_plan_path
     and bundle.projections_xlsx_path = p_final_projections_path
     and bundle.feasibility_pdf_path = p_final_feasibility_path
   for share;

  if not found then
    raise exception 'seal_snapshot_binding_stale';
  end if;

  insert into public.buddy_sealed_packages (
    deal_id,
    bank_id,
    sealed_snapshot,
    final_business_plan_path,
    final_projections_path,
    final_feasibility_path
  ) values (
    p_deal_id,
    p_bank_id,
    p_sealed_snapshot,
    p_final_business_plan_path,
    p_final_projections_path,
    p_final_feasibility_path
  )
  returning id into v_sealed_package_id;

  insert into public.marketplace_listings (
    sealed_package_id,
    deal_id,
    kfs,
    kfs_redaction_version,
    score,
    band,
    rate_card_tier,
    published_rate_bps,
    sba_program,
    loan_amount,
    term_months,
    matched_lender_bank_ids,
    preview_opens_at,
    claim_opens_at,
    claim_closes_at
  ) values (
    v_sealed_package_id,
    p_deal_id,
    p_kfs,
    p_kfs_redaction_version,
    p_score,
    p_band,
    p_rate_card_tier,
    p_published_rate_bps,
    p_sba_program,
    p_loan_amount,
    p_term_months,
    coalesce(p_matched_lender_bank_ids, '{}'::uuid[]),
    p_preview_opens_at,
    p_claim_opens_at,
    p_claim_closes_at
  )
  returning id into v_listing_id;

  update public.deals
     set status = 'sealed'
   where id = p_deal_id
     and bank_id = p_bank_id
  returning status into v_deal_status;

  if not found or v_deal_status is distinct from 'sealed' then
    raise exception 'seal_deal_transition_unproven';
  end if;

  return query select v_sealed_package_id, v_listing_id;
end;
$$;

create or replace function public.unseal_buddy_marketplace_listing(
  p_deal_id uuid,
  p_bank_id uuid,
  p_reason text default 'borrower_requested'
)
returns table(sealed_package_id uuid, listing_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal_id uuid;
  v_sealed_package_id uuid;
  v_listing_id uuid;
  v_updated_seal_id uuid;
  v_deleted_listing_id uuid;
  v_deal_status text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_deal_id::text || ':final', 0)
  );

  select d.id
    into v_deal_id
    from public.deals d
   where d.id = p_deal_id
     and d.bank_id = p_bank_id
   for update;

  if not found then
    raise exception 'unseal_deal_not_found_or_tenant_mismatch';
  end if;

  select listing.id, listing.sealed_package_id
    into v_listing_id, v_sealed_package_id
    from public.marketplace_listings listing
   where listing.deal_id = p_deal_id
     and listing.status = 'pending_preview'
   order by listing.created_at desc
   limit 1
   for update;

  -- No eligible listing is a business-state outcome, not a database failure.
  if not found then
    return;
  end if;

  perform 1
    from public.buddy_sealed_packages sealed
   where sealed.id = v_sealed_package_id
     and sealed.deal_id = p_deal_id
     and sealed.bank_id = p_bank_id
     and sealed.unsealed_at is null
   for update;

  if not found then
    raise exception 'unseal_active_package_not_found';
  end if;

  update public.buddy_sealed_packages
     set unsealed_at = pg_catalog.clock_timestamp(),
         unseal_reason = coalesce(
           nullif(p_reason, ''),
           'borrower_requested'
         )
   where id = v_sealed_package_id
     and deal_id = p_deal_id
     and bank_id = p_bank_id
     and unsealed_at is null
  returning id into v_updated_seal_id;

  if not found or v_updated_seal_id is distinct from v_sealed_package_id then
    raise exception 'unseal_package_transition_unproven';
  end if;

  delete from public.marketplace_listings
   where id = v_listing_id
     and deal_id = p_deal_id
     and status = 'pending_preview'
  returning id into v_deleted_listing_id;

  if not found or v_deleted_listing_id is distinct from v_listing_id then
    raise exception 'unseal_listing_transition_unproven';
  end if;

  update public.deals
     set status = 'draft'
   where id = p_deal_id
     and bank_id = p_bank_id
  returning status into v_deal_status;

  if not found or v_deal_status is distinct from 'draft' then
    raise exception 'unseal_deal_transition_unproven';
  end if;

  return query select v_sealed_package_id, v_listing_id;
end;
$$;

revoke all on function public.create_buddy_seal_listing(
  uuid,uuid,jsonb,text,text,text,jsonb,text,integer,text,text,integer,text,numeric,
  integer,uuid[],timestamptz,timestamptz,timestamptz
) from public, anon, authenticated;
revoke all on function public.unseal_buddy_marketplace_listing(uuid,uuid,text)
  from public, anon, authenticated;

grant execute on function public.create_buddy_seal_listing(
  uuid,uuid,jsonb,text,text,text,jsonb,text,integer,text,text,integer,text,numeric,
  integer,uuid[],timestamptz,timestamptz,timestamptz
) to service_role;
grant execute on function public.unseal_buddy_marketplace_listing(uuid,uuid,text)
  to service_role;

comment on function public.create_buddy_seal_listing(
  uuid,uuid,jsonb,text,text,text,jsonb,text,integer,text,text,integer,text,numeric,
  integer,uuid[],timestamptz,timestamptz,timestamptz
) is
  'Atomically proves the current final Golden Trident, creates its active seal and marketplace listing, and advances the tenant deal to sealed.';

comment on function public.unseal_buddy_marketplace_listing(uuid,uuid,text) is
  'Atomically unseals a tenant-owned pending-preview package, removes its listing, and returns the deal to draft.';

notify pgrst, 'reload schema';

commit;
