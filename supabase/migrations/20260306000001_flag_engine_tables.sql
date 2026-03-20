-- Flag Engine tables — Intelligent Flagging & Borrower Question Engine
-- Phase 3B of God Tier specification

-- deal_flags: every auto-detected or manual flag on a deal
create table if not exists deal_flags (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  category text not null,            -- financial_irregularity | missing_data | policy_proximity | qualitative_risk
  severity text not null,            -- critical | elevated | watch | informational
  trigger_type text not null,
  canonical_keys_involved text[] default '{}',
  observed_value text,
  expected_range_min numeric,
  expected_range_max numeric,
  expected_range_description text,
  year_observed integer,
  banker_summary text not null,
  banker_detail text not null,
  banker_implication text not null,
  has_borrower_question boolean default false,
  status text not null default 'open',  -- open | banker_reviewed | sent_to_borrower | answered | resolved | waived
  banker_note text,
  borrower_response text,
  resolution_note text,
  waived_by text,
  waived_reason text,
  auto_generated boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_deal_flags_deal_id on deal_flags(deal_id);
create index if not exists idx_deal_flags_status on deal_flags(status);
create index if not exists idx_deal_flags_severity on deal_flags(severity);

-- deal_borrower_questions: questions generated from flags, sent to borrower/accountant/etc.
create table if not exists deal_borrower_questions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  flag_id uuid not null references deal_flags(id),
  question_text text not null,
  question_context text not null,
  document_requested text,
  document_format text,
  document_urgency text not null default 'required_before_approval',  -- required_before_approval | required_before_closing | preferred
  recipient_type text not null default 'borrower',                    -- borrower | accountant | attorney | appraiser
  send_method text,
  sent_at timestamptz,
  answered_at timestamptz,
  answer_text text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_deal_borrower_questions_deal_id on deal_borrower_questions(deal_id);
create index if not exists idx_deal_borrower_questions_flag_id on deal_borrower_questions(flag_id);

-- deal_flag_audit: immutable audit trail for every flag lifecycle event
create table if not exists deal_flag_audit (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  flag_id uuid not null,
  action text not null,       -- generated | reviewed | question_sent | answered | resolved | waived | reopened
  actor text,                 -- system | banker user id
  previous_status text,
  new_status text,
  note text,
  created_at timestamptz default now()
);

create index if not exists idx_deal_flag_audit_deal_id on deal_flag_audit(deal_id);
create index if not exists idx_deal_flag_audit_flag_id on deal_flag_audit(flag_id);
