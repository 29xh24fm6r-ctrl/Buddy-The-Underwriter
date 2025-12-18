-- =========================================================
-- BORROWER PORTAL FOUNDATION
-- Step 2.1: Database tables for borrower portal
-- Run in Supabase SQL Editor (Role: postgres)
-- =========================================================

create extension if not exists pgcrypto;

-- =========================================================
-- 1) APPLICATIONS (borrower submissions)
-- =========================================================

create table if not exists public.borrower_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, -- Lender who created the application request
  deal_id uuid, -- Links to deal once created (null until submit)

  -- Access token for magic link
  access_token text unique not null default encode(gen_random_bytes(32), 'hex'),
  token_expires_at timestamptz,

  -- Application metadata
  application_type text not null default 'SBA_7A', -- SBA_7A | CONVENTIONAL | BRIDGE
  status text not null default 'DRAFT', -- DRAFT | IN_PROGRESS | SUBMITTED | CONVERTED
  
  -- Business info (collected from borrower)
  business_name text,
  business_legal_name text,
  business_ein text,
  business_address jsonb, -- { street, city, state, zip }
  business_phone text,
  business_email text,
  
  -- Loan request
  loan_amount numeric,
  loan_purpose text,
  use_of_proceeds jsonb, -- { category: amount }
  
  -- SBA eligibility snapshot
  sba_eligible boolean, -- true | false | null (unknown)
  sba_eligibility_reasons text[],
  sba_eligibility_missing text[],
  
  -- Submission
  submitted_at timestamptz,
  submitted_by_name text,
  submitted_by_email text,
  
  -- Metadata
  meta jsonb default '{}'::jsonb,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint borrower_applications_status_check 
    check (status in ('DRAFT', 'IN_PROGRESS', 'SUBMITTED', 'CONVERTED'))
);

create index if not exists borrower_applications_user_id_idx on public.borrower_applications(user_id);
create index if not exists borrower_applications_deal_id_idx on public.borrower_applications(deal_id);
create index if not exists borrower_applications_access_token_idx on public.borrower_applications(access_token);
create index if not exists borrower_applications_status_idx on public.borrower_applications(status);

comment on table public.borrower_applications is 'Borrower loan applications (magic link portal)';
comment on column public.borrower_applications.access_token is 'Magic link token for borrower access';
comment on column public.borrower_applications.sba_eligible is 'SBA 7(a) eligibility determination';

-- =========================================================
-- 2) APPLICANTS (owners, guarantors, key persons)
-- =========================================================

create table if not exists public.borrower_applicants (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.borrower_applications(id) on delete cascade,
  
  -- Person info
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  ssn text, -- Encrypted in production
  date_of_birth date,
  
  -- Role
  applicant_type text not null default 'OWNER', -- OWNER | GUARANTOR | KEY_PERSON
  ownership_percent numeric,
  title text,
  
  -- Address
  address jsonb, -- { street, city, state, zip }
  
  -- Metadata
  meta jsonb default '{}'::jsonb,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint borrower_applicants_type_check 
    check (applicant_type in ('OWNER', 'GUARANTOR', 'KEY_PERSON'))
);

create index if not exists borrower_applicants_application_id_idx on public.borrower_applicants(application_id);
create index if not exists borrower_applicants_type_idx on public.borrower_applicants(applicant_type);

comment on table public.borrower_applicants is 'Owners, guarantors, and key persons for loan applications';

-- =========================================================
-- 3) ANSWERS (borrower wizard responses)
-- =========================================================

create table if not exists public.borrower_answers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.borrower_applications(id) on delete cascade,
  
  -- Question
  question_key text not null, -- e.g., "sba_size_standard_compliant"
  question_section text, -- e.g., "SBA_ELIGIBILITY"
  
  -- Answer
  answer_type text not null, -- TEXT | NUMBER | BOOLEAN | SELECT | MULTI_SELECT | DATE
  answer_value jsonb not null, -- Flexible storage for any answer type
  
  -- Context
  answered_at timestamptz not null default now(),
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(application_id, question_key)
);

create index if not exists borrower_answers_application_id_idx on public.borrower_answers(application_id);
create index if not exists borrower_answers_question_key_idx on public.borrower_answers(question_key);
create index if not exists borrower_answers_section_idx on public.borrower_answers(question_section);

comment on table public.borrower_answers is 'Borrower wizard question answers';
comment on column public.borrower_answers.answer_value is 'JSONB: flexible answer storage';

-- =========================================================
-- 4) UPLOADED FILES (borrower uploads)
-- =========================================================

create table if not exists public.borrower_uploads (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.borrower_applications(id) on delete cascade,
  
  -- File info
  file_key text not null, -- Supabase Storage path: deal_uploads/{dealId}/{appId}/{filename}
  original_filename text not null,
  mime_type text,
  file_size bigint,
  
  -- Classification (optional, can be null until processed)
  doc_type text,
  classification jsonb,
  
  -- Metadata
  uploaded_at timestamptz not null default now(),
  meta jsonb default '{}'::jsonb,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists borrower_uploads_application_id_idx on public.borrower_uploads(application_id);
create index if not exists borrower_uploads_file_key_idx on public.borrower_uploads(file_key);

comment on table public.borrower_uploads is 'Files uploaded by borrowers via portal';
comment on column public.borrower_uploads.file_key is 'Supabase Storage path';

-- =========================================================
-- 5) UPDATED_AT TRIGGERS
-- =========================================================

drop trigger if exists trg_borrower_applications_updated_at on public.borrower_applications;
create trigger trg_borrower_applications_updated_at
before update on public.borrower_applications
for each row execute function public.set_updated_at();

drop trigger if exists trg_borrower_applicants_updated_at on public.borrower_applicants;
create trigger trg_borrower_applicants_updated_at
before update on public.borrower_applicants
for each row execute function public.set_updated_at();

drop trigger if exists trg_borrower_answers_updated_at on public.borrower_answers;
create trigger trg_borrower_answers_updated_at
before update on public.borrower_answers
for each row execute function public.set_updated_at();

drop trigger if exists trg_borrower_uploads_updated_at on public.borrower_uploads;
create trigger trg_borrower_uploads_updated_at
before update on public.borrower_uploads
for each row execute function public.set_updated_at();

-- =========================================================
-- 6) ROW LEVEL SECURITY
-- =========================================================

alter table public.borrower_applications enable row level security;
alter table public.borrower_applicants enable row level security;
alter table public.borrower_answers enable row level security;
alter table public.borrower_uploads enable row level security;

-- Applications: accessible by creator or via valid token
drop policy if exists borrower_applications_select_own on public.borrower_applications;
create policy borrower_applications_select_own on public.borrower_applications
for select using (user_id = auth.uid());

drop policy if exists borrower_applications_insert_own on public.borrower_applications;
create policy borrower_applications_insert_own on public.borrower_applications
for insert with check (user_id = auth.uid());

drop policy if exists borrower_applications_update_own on public.borrower_applications;
create policy borrower_applications_update_own on public.borrower_applications
for update using (user_id = auth.uid());

-- Applicants: accessible via parent application
drop policy if exists borrower_applicants_select on public.borrower_applicants;
create policy borrower_applicants_select on public.borrower_applicants
for select using (
  exists (
    select 1 from public.borrower_applications
    where id = borrower_applicants.application_id
      and user_id = auth.uid()
  )
);

drop policy if exists borrower_applicants_insert on public.borrower_applicants;
create policy borrower_applicants_insert on public.borrower_applicants
for insert with check (
  exists (
    select 1 from public.borrower_applications
    where id = borrower_applicants.application_id
      and user_id = auth.uid()
  )
);

drop policy if exists borrower_applicants_update on public.borrower_applicants;
create policy borrower_applicants_update on public.borrower_applicants
for update using (
  exists (
    select 1 from public.borrower_applications
    where id = borrower_applicants.application_id
      and user_id = auth.uid()
  )
);

-- Answers: accessible via parent application
drop policy if exists borrower_answers_select on public.borrower_answers;
create policy borrower_answers_select on public.borrower_answers
for select using (
  exists (
    select 1 from public.borrower_applications
    where id = borrower_answers.application_id
      and user_id = auth.uid()
  )
);

drop policy if exists borrower_answers_insert on public.borrower_answers;
create policy borrower_answers_insert on public.borrower_answers
for insert with check (
  exists (
    select 1 from public.borrower_applications
    where id = borrower_answers.application_id
      and user_id = auth.uid()
  )
);

drop policy if exists borrower_answers_update on public.borrower_answers;
create policy borrower_answers_update on public.borrower_answers
for update using (
  exists (
    select 1 from public.borrower_applications
    where id = borrower_answers.application_id
      and user_id = auth.uid()
  )
);

-- Uploads: accessible via parent application
drop policy if exists borrower_uploads_select on public.borrower_uploads;
create policy borrower_uploads_select on public.borrower_uploads
for select using (
  exists (
    select 1 from public.borrower_applications
    where id = borrower_uploads.application_id
      and user_id = auth.uid()
  )
);

drop policy if exists borrower_uploads_insert on public.borrower_uploads;
create policy borrower_uploads_insert on public.borrower_uploads
for insert with check (
  exists (
    select 1 from public.borrower_applications
    where id = borrower_uploads.application_id
      and user_id = auth.uid()
  )
);

-- =========================================================
-- 7) HELPER FUNCTIONS
-- =========================================================

-- Generate new application with token
create or replace function public.create_borrower_application(
  p_user_id uuid,
  p_application_type text default 'SBA_7A'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_app_id uuid;
begin
  insert into public.borrower_applications (
    user_id,
    application_type,
    status,
    token_expires_at
  ) values (
    p_user_id,
    p_application_type,
    'DRAFT',
    now() + interval '30 days' -- Token expires in 30 days
  )
  returning id into v_app_id;

  return v_app_id;
end;
$$;

comment on function public.create_borrower_application is 'Create new borrower application with magic link token';

-- Validate access token
create or replace function public.validate_borrower_token(p_token text)
returns table(
  application_id uuid,
  is_valid boolean,
  expires_at timestamptz,
  status text
)
language plpgsql
security definer
as $$
begin
  return query
  select
    id as application_id,
    (token_expires_at is null or token_expires_at > now()) as is_valid,
    token_expires_at as expires_at,
    borrower_applications.status
  from public.borrower_applications
  where access_token = p_token;
end;
$$;

comment on function public.validate_borrower_token is 'Check if borrower access token is valid';

-- =========================================================
-- MIGRATION COMPLETE
-- =========================================================
-- Next: Create Supabase Storage bucket "deal_uploads"
-- Then: Implement API routes for borrower portal
-- =========================================================
