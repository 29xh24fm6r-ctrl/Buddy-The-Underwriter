-- SPEC-BIE-COMMITTEE-ACTION-CENTER-AND-OFFICIAL-PDF-CAPTURE-1 — Phase 1
--
-- Upgrade source artifacts so the actual captured OFFICIAL source (the fetched
-- HTML page, or native-PDF bytes stored base64) is distinguished from Buddy's
-- generated evidence receipt. Captured content is stored INLINE within the
-- existing 1.5MB fetch cap (no new storage infra), mirroring the existing
-- `artifact_html` inline pattern.
--
-- Additive + nullable/defaulted — existing rows keep working (official capture
-- defaults to "none / not available", receipt remains available). This migration
-- does NOT change committee scoring, eligibility, the research gate, or any
-- review semantics; it only adds capture-provenance columns.

alter table public.buddy_research_source_artifacts
  add column if not exists official_capture_available boolean not null default false,
  add column if not exists official_capture_format text not null default 'none',
  add column if not exists official_capture_status text not null default 'none',
  add column if not exists official_capture_hash text,
  add column if not exists official_capture_url text,
  add column if not exists official_capture_limitations jsonb not null default '[]'::jsonb,
  add column if not exists official_capture_content text,
  add column if not exists official_capture_content_encoding text not null default 'none',
  add column if not exists receipt_pdf_available boolean not null default true;

-- official_capture_format: none | html | pdf
-- official_capture_content_encoding: none | utf8 | base64
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bsa_official_capture_format_chk') then
    alter table public.buddy_research_source_artifacts
      add constraint bsa_official_capture_format_chk
      check (official_capture_format in ('none', 'html', 'pdf'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bsa_official_capture_encoding_chk') then
    alter table public.buddy_research_source_artifacts
      add constraint bsa_official_capture_encoding_chk
      check (official_capture_content_encoding in ('none', 'utf8', 'base64'));
  end if;
end $$;

comment on column public.buddy_research_source_artifacts.official_capture_available is
  'True only when a usable OFFICIAL source capture is stored (not a search form, content retained). A Buddy receipt alone does not make this true.';
comment on column public.buddy_research_source_artifacts.official_capture_status is
  'captured | search_form_only | not_retained | fetch_failed | none';
