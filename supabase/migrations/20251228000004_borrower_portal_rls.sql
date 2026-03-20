-- ================================================
-- RLS POLICIES: borrower portal tables
-- ================================================

alter table public.borrower_portal_links enable row level security;
alter table public.uploads enable row level security;
alter table public.deal_uploads enable row level security;
alter table public.doc_extractions enable row level security;
alter table public.doc_fields enable row level security;
alter table public.doc_submissions enable row level security;
alter table public.deal_events enable row level security;

-- Default: deny all from anon/authenticated unless via server/service role.
-- (Service role bypasses RLS.)

do $$
begin
  -- borrower_portal_links: underwriters can manage
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='borrower_portal_links' and policyname='underwriter_manage_links') then
    execute $p$
      create policy underwriter_manage_links
      on public.borrower_portal_links
      for all
      to authenticated
      using (true)
      with check (true);
    $p$;
  end if;

  -- uploads: underwriters can manage
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='uploads' and policyname='underwriter_manage_uploads') then
    execute $p$
      create policy underwriter_manage_uploads
      on public.uploads
      for all
      to authenticated
      using (true)
      with check (true);
    $p$;
  end if;

  -- deal_uploads: underwriters can manage
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='deal_uploads' and policyname='underwriter_manage_deal_uploads') then
    execute $p$
      create policy underwriter_manage_deal_uploads
      on public.deal_uploads
      for all
      to authenticated
      using (true)
      with check (true);
    $p$;
  end if;

  -- doc_fields/extractions/submissions/events: underwriters can read
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='doc_fields' and policyname='underwriter_manage_doc_fields') then
    execute $p$
      create policy underwriter_manage_doc_fields
      on public.doc_fields
      for all
      to authenticated
      using (true)
      with check (true);
    $p$;
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='doc_extractions' and policyname='underwriter_manage_doc_extractions') then
    execute $p$
      create policy underwriter_manage_doc_extractions
      on public.doc_extractions
      for all
      to authenticated
      using (true)
      with check (true);
    $p$;
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='doc_submissions' and policyname='underwriter_manage_doc_submissions') then
    execute $p$
      create policy underwriter_manage_doc_submissions
      on public.doc_submissions
      for all
      to authenticated
      using (true)
      with check (true);
    $p$;
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='deal_events' and policyname='underwriter_manage_deal_events') then
    execute $p$
      create policy underwriter_manage_deal_events
      on public.deal_events
      for all
      to authenticated
      using (true)
      with check (true);
    $p$;
  end if;
end $$;
