-- Phase 2: Virus Scanning Infrastructure
-- Adds async virus scanning support to deal_documents
-- Non-blocking: Files are immediately accessible, marked 'clean' after scan

-- Add virus scanning status columns
alter table deal_documents
add column if not exists virus_status text default 'pending',
add column if not exists virus_scanned_at timestamptz,
add column if not exists virus_engine text,
add column if not exists virus_signature text;

-- Add index for virus status queries
create index if not exists idx_deal_documents_virus_status 
on deal_documents (virus_status);

-- Add index for unscanned documents (for worker queries)
create index if not exists idx_deal_documents_pending_scan 
on deal_documents (virus_status, created_at)
where virus_status = 'pending';

-- Comment documentation
comment on column deal_documents.virus_status is 'Virus scan status: pending, clean, infected, scan_failed';
comment on column deal_documents.virus_scanned_at is 'Timestamp when virus scan completed';
comment on column deal_documents.virus_engine is 'Scanner engine name/version (e.g., ClamAV 1.0.0)';
comment on column deal_documents.virus_signature is 'Virus signature if infected, or null if clean';

-- Add constraint for valid virus_status values
alter table deal_documents
add constraint deal_documents_virus_status_check
check (virus_status in ('pending', 'clean', 'infected', 'scan_failed'));
