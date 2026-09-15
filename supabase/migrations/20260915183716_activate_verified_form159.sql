-- Apply only after the fail-closed render159.ts release is deployed.
-- Restore the verified uploaded asset without replacing a lender's template.
UPDATE public.bank_document_templates
SET is_active = true,
    metadata = (metadata - 'pending' - 'reactivate_with') || jsonb_build_object(
      'reactivated_at', now(),
      'reactivated_reason', 'Verified official PDF deployed; renderer rejects missing or incorrectly typed fields'
    )
WHERE bank_id IS NULL AND template_key = 'SBA_159' AND is_active = false
  AND file_path = 'sba-templates/SBA_159.pdf'
  AND file_sha256 = '182731098edcba9beb1db04449ad5b6b95c899076a2b96612a22e689c1dfe398';
