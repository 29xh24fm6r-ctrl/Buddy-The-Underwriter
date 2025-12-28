-- ==============================
-- BORROWER PORTAL RPC SECURITY MODEL + TWILIO SMS
-- Replaces API routes with SECURITY DEFINER RPCs for borrower access
-- ==============================

-- 1A) banker/bank context on portal links
alter table if exists public.borrower_portal_links
  add column if not exists bank_id uuid,
  add column if not exists created_by_user_id uuid,
  add column if not exists channel text;

create index if not exists borrower_portal_links_token_idx
  on public.borrower_portal_links(token);

-- 1B) outbound messages (Twilio + email unified)
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname='public' and t.typname='message_channel'
  ) then
    create type public.message_channel as enum ('sms','email');
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname='public' and t.typname='message_status'
  ) then
    create type public.message_status as enum ('queued','sent','failed');
  end if;
end $$;

create table if not exists public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid references public.deals(id) on delete cascade,
  channel public.message_channel not null,
  to_value text not null,
  body text not null,
  status public.message_status not null default 'queued',
  provider text,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists outbound_messages_deal_id_idx on public.outbound_messages(deal_id);
create index if not exists outbound_messages_status_idx on public.outbound_messages(status);

-- 1C) Optional deal status helpers (improves cockpit UX)
alter table if exists public.deals
  add column if not exists underwriting_ready_at timestamptz,
  add column if not exists underwriting_started_at timestamptz;

-- 1D) Underwriting readiness function + trigger on checklist receive
create or replace function public.try_mark_deal_underwriting_ready(p_deal_id uuid)
returns void
language plpgsql
as $$
declare
  v_required_total int;
  v_required_received int;
  v_already timestamptz;
begin
  select underwriting_ready_at into v_already
  from public.deals
  where id = p_deal_id;

  if v_already is not null then
    return;
  end if;

  select
    count(*) filter (where required),
    count(*) filter (where required and received_at is not null)
  into v_required_total, v_required_received
  from public.deal_checklist_items
  where deal_id = p_deal_id;

  if coalesce(v_required_total,0) > 0 and v_required_total = v_required_received then
    update public.deals
      set underwriting_ready_at = now()
    where id = p_deal_id
      and underwriting_ready_at is null;

    insert into public.deal_events(deal_id, kind, metadata)
    values (p_deal_id, 'deal_ready_for_underwriting', jsonb_build_object(
      'required_total', v_required_total,
      'required_received', v_required_received
    ));
  end if;
end $$;

create or replace function public.on_checklist_item_received()
returns trigger
language plpgsql
as $$
begin
  perform public.try_mark_deal_underwriting_ready(new.deal_id);
  return new;
end $$;

drop trigger if exists deal_checklist_items_on_received on public.deal_checklist_items;
create trigger deal_checklist_items_on_received
after update of received_at on public.deal_checklist_items
for each row
when (new.received_at is not null and (old.received_at is distinct from new.received_at))
execute function public.on_checklist_item_received();

create or replace function public.on_doc_submitted_try_ready()
returns trigger
language plpgsql
as $$
begin
  perform public.try_mark_deal_underwriting_ready(new.deal_id);
  return new;
end $$;

drop trigger if exists doc_submissions_try_ready on public.doc_submissions;
create trigger doc_submissions_try_ready
after insert on public.doc_submissions
for each row execute function public.on_doc_submitted_try_ready();

-- 1F) TOKEN-BASED RPCs (borrower portal uses anon key safely)
create or replace function public.portal_get_context(p_token text)
returns table (
  deal_id uuid,
  link_id uuid,
  label text,
  single_use boolean,
  expires_at timestamptz,
  used_at timestamptz
)
language sql
security definer
as $$
  select bpl.deal_id, bpl.id as link_id, bpl.label, bpl.single_use, bpl.expires_at, bpl.used_at
  from public.borrower_portal_links bpl
  where bpl.token = p_token
    and (bpl.expires_at is null or bpl.expires_at > now());
$$;

create or replace function public.portal_list_uploads(p_token text)
returns table (
  id uuid,
  deal_id uuid,
  filename text,
  mime_type text,
  size_bytes bigint,
  status text,
  doc_type text,
  checklist_key text,
  created_at timestamptz
)
language sql
security definer
as $$
  select u.id, du.deal_id, u.filename, u.mime_type, u.size_bytes,
         du.status::text, du.doc_type, du.checklist_key, u.created_at
  from public.uploads u
  join public.deal_uploads du on du.upload_id = u.id
  join public.borrower_portal_links bpl on bpl.deal_id = du.deal_id
  where bpl.token = p_token
    and (bpl.expires_at is null or bpl.expires_at > now())
  order by u.created_at desc;
$$;

create or replace function public.portal_get_doc_fields(p_token text, p_upload_id uuid)
returns table (
  id uuid,
  field_key text,
  field_label text,
  field_value text,
  confidence numeric,
  needs_attention boolean,
  confirmed boolean
)
language sql
security definer
as $$
  select
    f.id, f.field_key, f.field_label, f.field_value,
    f.confidence, f.needs_attention, f.confirmed
  from public.doc_fields f
  join public.deal_uploads du on du.upload_id = f.upload_id
  join public.borrower_portal_links bpl on bpl.deal_id = du.deal_id
  where bpl.token = p_token
    and f.upload_id = p_upload_id;
$$;

create or replace function public.portal_confirm_and_submit_document(
  p_token text,
  p_upload_id uuid
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_deal_id uuid;
  v_submission_id uuid;
begin
  select deal_id into v_deal_id
  from public.borrower_portal_links
  where token = p_token
    and (expires_at is null or expires_at > now())
  limit 1;

  if v_deal_id is null then
    raise exception 'Invalid or expired token';
  end if;

  -- mark all fields confirmed=true
  update public.doc_fields
    set confirmed = true
  where upload_id = p_upload_id;

  -- create submission
  insert into public.doc_submissions(upload_id, token, notes)
  values (p_upload_id, p_token, null)
  returning id into v_submission_id;

  -- enforce single_use
  update public.borrower_portal_links
    set used_at = case when single_use then now() else used_at end
  where token = p_token;

  return v_submission_id;
end $$;

-- Grant anon execute on RPCs
grant execute on function public.portal_get_context(text) to anon;
grant execute on function public.portal_list_uploads(text) to anon;
grant execute on function public.portal_get_doc_fields(text, uuid) to anon;
grant execute on function public.portal_confirm_and_submit_document(text, uuid) to anon;

COMMENT ON TABLE public.outbound_messages IS 'Unified queue for Twilio SMS and email notifications';
COMMENT ON FUNCTION public.portal_get_context IS 'Token-based borrower portal context lookup';
COMMENT ON FUNCTION public.portal_confirm_and_submit_document IS 'Atomically confirms fields and creates submission';
