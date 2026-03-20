-- 20260205_fix_user_id_columns_to_text.sql
-- Convert user ID columns from uuid to text to support Clerk user IDs
-- which are strings like "user_3724xzcnmkMSgu..." instead of UUIDs.

BEGIN;

-- Change created_by from uuid to text
ALTER TABLE public.deal_loan_requests
  ALTER COLUMN created_by TYPE text USING created_by::text;

-- Change decision_by from uuid to text
ALTER TABLE public.deal_loan_requests
  ALTER COLUMN decision_by TYPE text USING decision_by::text;

COMMIT;
