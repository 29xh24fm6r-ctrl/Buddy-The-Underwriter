-- =========================================================
-- Checklist Engine v2 — Year-aware satisfaction
-- =========================================================

-- 1) deal_documents: match metadata + inferred year
alter table public.deal_documents
  add column if not exists match_confidence numeric,
  add column if not exists match_reason text,
  add column if not exists match_source text,
  add column if not exists doc_year int;

-- 2) deal_checklist_items: satisfaction fields
alter table public.deal_checklist_items
  add column if not exists satisfied_at timestamptz,
  add column if not exists satisfaction_json jsonb;

-- 3) A small rules table (override-able) describing satisfaction requirements
--    If you don't want another table, you can skip and hardcode; but this is cleaner.
create table if not exists public.deal_checklist_rules (
  checklist_key text primary key,
  requires_years int not null default 0,          -- e.g. 2 for "2Y"
  allowed_doc_types text[] null,                  -- future use
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deal_checklist_rules_requires_years_idx
  on public.deal_checklist_rules(requires_years);

-- 4) Seed core rules (idempotent)
insert into public.deal_checklist_rules (checklist_key, requires_years)
values
  ('IRS_BUSINESS_2Y', 2),
  ('IRS_PERSONAL_2Y', 2),
  ('BTR_2Y', 2)
on conflict (checklist_key) do update
set requires_years = excluded.requires_years,
    updated_at = now();

-- 5) Helper: compute satisfaction for a given deal + checklist_key
--    Satisfied if:
--      - requires_years = 0 -> any doc exists for key
--      - requires_years = N -> at least N DISTINCT doc_year values exist (non-null)
create or replace function public._checklist_compute_satisfaction(
  p_deal_id uuid,
  p_checklist_key text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_requires int := 0;
  v_years int[];
  v_year_count int := 0;
  v_any_count int := 0;
begin
  select coalesce(r.requires_years, 0)
    into v_requires
  from public.deal_checklist_rules r
  where r.checklist_key = p_checklist_key;

  select count(*)
    into v_any_count
  from public.deal_documents d
  where d.deal_id = p_deal_id
    and d.checklist_key = p_checklist_key;

  select array_agg(distinct d.doc_year order by d.doc_year)
    into v_years
  from public.deal_documents d
  where d.deal_id = p_deal_id
    and d.checklist_key = p_checklist_key
    and d.doc_year is not null;

  v_year_count := coalesce(array_length(v_years, 1), 0);

  return jsonb_build_object(
    'checklist_key', p_checklist_key,
    'requires_years', v_requires,
    'doc_count', v_any_count,
    'years', coalesce(to_jsonb(v_years), '[]'::jsonb),
    'year_count', v_year_count,
    'satisfied', case
      when v_requires <= 0 then (v_any_count > 0)
      else (v_year_count >= v_requires)
    end
  );
end;
$$;

-- 6) Apply satisfaction state to deal_checklist_items
create or replace function public._checklist_apply_satisfaction(
  p_deal_id uuid,
  p_checklist_key text,
  p_document_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_sat jsonb;
  v_satisfied boolean;
begin
  v_sat := public._checklist_compute_satisfaction(p_deal_id, p_checklist_key);
  v_satisfied := coalesce((v_sat->>'satisfied')::boolean, false);

  update public.deal_checklist_items c
  set
    -- received_at: first evidence seen
    received_at = coalesce(c.received_at, now()),
    received_document_id = coalesce(c.received_document_id, p_document_id),
    satisfaction_json = v_sat,
    satisfied_at = case when v_satisfied then coalesce(c.satisfied_at, now()) else null end,
    status = case
      when v_satisfied then 'received'
      when c.required then 'missing'
      else coalesce(c.status, 'pending')
    end,
    updated_at = now()
  where c.deal_id = p_deal_id
    and c.checklist_key = p_checklist_key;
end;
$$;

-- 7) Trigger: on insert/update of deal_documents.checklist_key or doc_year, recompute satisfaction
create or replace function public.trg_deal_documents_checklist_satisfaction()
returns trigger
language plpgsql
security definer
as $$
begin
  -- INSERT: if checklist_key present -> recompute
  if (tg_op = 'INSERT') then
    if new.checklist_key is not null and length(new.checklist_key) > 0 then
      perform public._checklist_apply_satisfaction(new.deal_id, new.checklist_key, new.id);
    end if;
    return new;
  end if;

  -- UPDATE: if checklist_key changed OR doc_year changed -> recompute new key and maybe old key
  if (tg_op = 'UPDATE') then
    if (new.checklist_key is distinct from old.checklist_key) or (new.doc_year is distinct from old.doc_year) then
      if new.checklist_key is not null and length(new.checklist_key) > 0 then
        perform public._checklist_apply_satisfaction(new.deal_id, new.checklist_key, new.id);
      end if;

      if old.checklist_key is not null and length(old.checklist_key) > 0 then
        -- re-evaluate old key too (maybe it becomes unsatisfied)
        perform public._checklist_apply_satisfaction(new.deal_id, old.checklist_key, new.id);
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

-- 8) Attach triggers (replace v1 triggers with v2)
drop trigger if exists deal_documents_checklist_reconcile_ins on public.deal_documents;
drop trigger if exists deal_documents_checklist_reconcile_upd on public.deal_documents;

drop trigger if exists deal_documents_checklist_satisfaction_ins on public.deal_documents;
create trigger deal_documents_checklist_satisfaction_ins
after insert on public.deal_documents
for each row
execute function public.trg_deal_documents_checklist_satisfaction();

drop trigger if exists deal_documents_checklist_satisfaction_upd on public.deal_documents;
create trigger deal_documents_checklist_satisfaction_upd
after update of checklist_key, doc_year on public.deal_documents
for each row
execute function public.trg_deal_documents_checklist_satisfaction();

-- 9) Revoke public access
revoke all on function public._checklist_compute_satisfaction(uuid, text) from public;
revoke all on function public._checklist_apply_satisfaction(uuid, text, uuid) from public;
revoke all on function public.trg_deal_documents_checklist_satisfaction() from public;
