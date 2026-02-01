-- =========================================================
-- Fix: AI checklist match propagation
--
-- Root cause: create_checklist_match() wrote evidence to
-- checklist_item_matches but never applied auto_applied
-- matches to the canonical deal_checklist_items row.
-- Readiness is computed from deal_checklist_items.status,
-- so it stayed stuck at 0%.
--
-- This patch adds an apply step: when a match becomes
-- auto_applied, flip the checklist row to 'received'.
-- =========================================================

create or replace function public.create_checklist_match(
  p_deal_id uuid,
  p_bank_id uuid,
  p_artifact_id uuid,
  p_checklist_key text,
  p_confidence numeric,
  p_reason text,
  p_match_source text,
  p_tax_year int default null,
  p_auto_apply boolean default false
) returns uuid
language plpgsql
security definer
as $$
declare
  v_match_id uuid;
  v_checklist_item_id uuid;
  v_status text;
  v_source_document_id uuid;
begin
  -- Find corresponding checklist item if it exists
  select id into v_checklist_item_id
  from public.deal_checklist_items
  where deal_id = p_deal_id and checklist_key = p_checklist_key
  limit 1;

  -- Determine status based on confidence and auto_apply flag
  if p_auto_apply and p_confidence >= 0.85 then
    v_status := 'auto_applied';
  else
    v_status := 'proposed';
  end if;

  insert into public.checklist_item_matches (
    deal_id,
    bank_id,
    artifact_id,
    checklist_item_id,
    checklist_key,
    confidence,
    reason,
    match_source,
    tax_year,
    status
  )
  values (
    p_deal_id,
    p_bank_id,
    p_artifact_id,
    v_checklist_item_id,
    p_checklist_key,
    p_confidence,
    p_reason,
    p_match_source,
    p_tax_year,
    v_status
  )
  on conflict (artifact_id, checklist_key, tax_year)
  do update set
    confidence = excluded.confidence,
    reason = excluded.reason,
    updated_at = now()
  returning id into v_match_id;

  -- =========================================================
  -- Apply auto-applied match to canonical checklist row
  -- =========================================================
  if v_status = 'auto_applied' then
    -- Guard: only apply if checklist item actually exists
    if v_checklist_item_id is null then
      raise notice 'create_checklist_match: auto_applied but no checklist item found for deal_id=%, checklist_key=%',
        p_deal_id, p_checklist_key;
    else
      -- Look up the source deal_documents.id from the artifact
      -- (received_document_id FK references deal_documents, not document_artifacts)
      select source_id into v_source_document_id
      from public.document_artifacts
      where id = p_artifact_id
        and source_table = 'deal_documents';

      -- Monotonic upgrade: only transition missing -> received
      update public.deal_checklist_items
      set
        status        = 'received',
        received_at   = now(),
        received_document_id = coalesce(v_source_document_id, received_document_id)
      where deal_id       = p_deal_id
        and checklist_key = p_checklist_key
        and status        = 'missing';
    end if;
  end if;

  return v_match_id;
end;
$$;
