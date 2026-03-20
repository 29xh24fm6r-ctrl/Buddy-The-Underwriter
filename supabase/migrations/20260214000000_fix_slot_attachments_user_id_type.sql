-- Fix: attached_by_user_id must be TEXT, not UUID.
-- Clerk user IDs are strings like "user_xxx", not UUIDs.
ALTER TABLE deal_document_slot_attachments
  ALTER COLUMN attached_by_user_id TYPE text USING attached_by_user_id::text;
