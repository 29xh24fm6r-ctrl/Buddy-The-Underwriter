-- Flag send packages — permanent record of questions sent to borrowers
CREATE TABLE IF NOT EXISTS deal_flag_send_packages (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id),
  sent_by text not null,
  cover_message text not null,
  question_count integer not null,
  document_request_count integer not null,
  package_json jsonb not null,
  sent_at timestamptz default now()
);
CREATE INDEX IF NOT EXISTS idx_flag_send_packages_deal ON deal_flag_send_packages(deal_id);

-- Unique constraint on deal_borrower_questions(flag_id) for upserts
ALTER TABLE deal_borrower_questions
  ADD CONSTRAINT uq_deal_borrower_questions_flag_id UNIQUE (flag_id);
