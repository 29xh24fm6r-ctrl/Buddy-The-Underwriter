-- =========================================================
-- Checklist Engine v1 — DB triggers & reconciliation
-- =========================================================
-- Assumptions (verified in your schema screenshots):
-- deal_checklist_items columns include:
--   id, deal_id, checklist_key, status, requested_at, received_at,
--   received_file_id, received_document_id, notes,
--   created_at, updated_at, title, required, description, received_upload_id
--
-- deal_documents columns include (observed):
--   id, deal_id, original_filename, checklist_key, created_at, ...
--
-- IMPORTANT:
-- - We'll ONLY rely on deal_documents.checklist_key for reconciliation.
-- - deal_files may exist, but is not the canonical evidence table.
-- =========================================================

-- 1) Helper function: normalize checklist status transitions safely
create or replace function public._checklist_mark_received(
  p_deal_id uuid,
  p_checklist_key text,
  p_document_id uuid
) returns void
language plpgsql
security definer
as $$
begin
  update public.deal_checklist_items c
  set
    received_at = coalesce(c.received_at, now()),
    status = case
      when c.status in ('missing','requested','pending') or c.status is null then 'received'
      else c.status
    end,
    received_document_id = coalesce(c.received_document_id, p_document_id),
    updated_at = now()
  where c.deal_id = p_deal_id
    and c.checklist_key = p_checklist_key;
end;
$$;

-- 2) Helper function: mark "unreceived" (only if no other docs exist for that key)
create or replace function public._checklist_maybe_unreceive(
  p_deal_id uuid,
  p_checklist_key text
) returns void
language plpgsql
security definer
as $$
declare
  v_has_any boolean;
begin
  select exists(
    select 1
    from public.deal_documents d
    where d.deal_id = p_deal_id
      and d.checklist_key = p_checklist_key
  ) into v_has_any;

  if not v_has_any then
    update public.deal_checklist_items c
    set
      received_at = null,
      received_document_id = null,
      status = case
        when c.required then 'missing'
        else coalesce(c.status,'pending')
      end,
      updated_at = now()
    where c.deal_id = p_deal_id
      and c.checklist_key = p_checklist_key;
  end if;
end;
$$;

-- 3) Trigger function: when a document gets a checklist_key, reconcile checklist
create or replace function public.trg_deal_documents_checklist_reconcile()
returns trigger
language plpgsql
security definer
as $$
begin
  -- If checklist_key added or changed to a non-null value, mark received
  if (tg_op = 'INSERT') then
    if new.checklist_key is not null and length(new.checklist_key) > 0 then
      perform public._checklist_mark_received(new.deal_id, new.checklist_key, new.id);
    end if;
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    -- If checklist_key transitioned from null->value or changed value
    if new.checklist_key is distinct from old.checklist_key then
      if new.checklist_key is not null and length(new.checklist_key) > 0 then
        perform public._checklist_mark_received(new.deal_id, new.checklist_key, new.id);
      end if;

      -- If old key existed and is now removed/changed, maybe unreceive old key
      if old.checklist_key is not null and length(old.checklist_key) > 0 then
        perform public._checklist_maybe_unreceive(new.deal_id, old.checklist_key);
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

-- 4) Attach triggers
drop trigger if exists deal_documents_checklist_reconcile_ins on public.deal_documents;
create trigger deal_documents_checklist_reconcile_ins
after insert on public.deal_documents
for each row
execute function public.trg_deal_documents_checklist_reconcile();

drop trigger if exists deal_documents_checklist_reconcile_upd on public.deal_documents;
create trigger deal_documents_checklist_reconcile_upd
after update of checklist_key on public.deal_documents
for each row
execute function public.trg_deal_documents_checklist_reconcile();

-- 5) RLS safety: triggers are SECURITY DEFINER; keep narrow surface area.
-- Ensure functions are owned by postgres/supabase admin and not exposed to anon.
revoke all on function public._checklist_mark_received(uuid, text, uuid) from public;
revoke all on function public._checklist_maybe_unreceive(uuid, text) from public;
revoke all on function public.trg_deal_documents_checklist_reconcile() from public;
