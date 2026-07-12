-- Backstop the application-level fix in attachDocumentToSlot.ts (which now
-- deactivates any other active attachment for a document before creating a
-- new one) with a real DB constraint: a document can only have one active
-- slot attachment at a time.
--
-- Verified against production before adding this: zero documents currently
-- have more than one active attachment (50 total rows / 40 active rows in
-- deal_document_slot_attachments, 0 duplicates by document_id), so this is
-- safe to apply directly.

create unique index if not exists uq_slot_attachments_active_document
  on deal_document_slot_attachments (document_id)
  where is_active;
