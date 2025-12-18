-- MEGA STEP 9: Auto-Generated Draft Borrower Requests
-- 
-- Maps missing CTC items → document types → draft emails
-- No LLM. Pure rules. Underwriter-approved before sending.
-- 
-- Run: supabase migration new draft_borrower_requests

-- Table: draft_borrower_requests
-- Stores auto-generated requests for missing documents
create table if not exists public.draft_borrower_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  
  -- What's missing (from conditions_to_close)
  condition_id uuid references public.conditions_to_close(id) on delete set null,
  missing_document_type text not null, -- 'tax_return', 'bank_statement', 'lease', etc.
  
  -- Draft request
  draft_subject text not null,
  draft_message text not null,
  evidence jsonb not null default '[]', -- Why this is needed (from condition resolution_evidence)
  
  -- Approval workflow
  status text not null default 'pending_approval',
    -- pending_approval: waiting for underwriter review
    -- approved: ready to send
    -- sent: delivered to borrower
    -- rejected: underwriter declined
  
  approved_by text, -- Clerk user ID
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  
  sent_at timestamptz,
  sent_via text, -- 'email', 'portal_notification', etc.
  
  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  -- Constraints
  constraint valid_status check (status in ('pending_approval', 'approved', 'sent', 'rejected'))
);

-- Indexes
create index if not exists idx_draft_requests_deal on public.draft_borrower_requests(deal_id);
create index if not exists idx_draft_requests_status on public.draft_borrower_requests(status);
create index if not exists idx_draft_requests_condition on public.draft_borrower_requests(condition_id);

-- Prevent duplicate drafts for same condition
create unique index if not exists uq_draft_requests_condition_active
  on public.draft_borrower_requests(condition_id)
  where status in ('pending_approval', 'approved')
    and condition_id is not null;

-- RLS policies
alter table public.draft_borrower_requests enable row level security;

-- Underwriters can manage drafts for their deals
create policy "Underwriters manage draft requests"
  on public.draft_borrower_requests
  for all
  using (
    exists (
      select 1 from public.deal_participants dp
      where dp.deal_id = draft_borrower_requests.deal_id
        and dp.user_id = auth.uid()
        and dp.role = 'underwriter'
        and dp.deleted_at is null
    )
  );

-- Admins can manage all drafts
create policy "Admins manage all draft requests"
  on public.draft_borrower_requests
  for all
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid()
        and role = 'admin'
    )
  );

-- Updated trigger
create or replace function public.update_draft_request_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger draft_request_updated
  before update on public.draft_borrower_requests
  for each row
  execute function public.update_draft_request_timestamp();

-- Comment
comment on table public.draft_borrower_requests is 'Auto-generated draft requests for missing documents. Requires underwriter approval before sending to borrower.';
