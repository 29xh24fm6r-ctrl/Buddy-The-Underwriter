-- Align the MCP-applied migration with its committed repository version.
UPDATE supabase_migrations.schema_migrations
SET version = '20260915161948'
WHERE version = '20260915182707' AND name = 'guided_package_answers'
  AND NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260915161948'
  );

-- Classify the explicitly synthetic application created during release verification.
-- Resolve its generated IDs from its unique QA identity; leave all real deals alone.
UPDATE public.deals d
SET is_test = true, test_suite = 'borrower_e2e', test_identity = 'borrower_qa',
    test_run_id = 'guided-package-54ad8fa-20260915', test_created_at = d.created_at
FROM public.borrowers b, public.banks bank
WHERE d.borrower_id = b.id AND d.bank_id = bank.id AND bank.bank_kind = 'brokerage'
  AND b.legal_name = 'Codex Guided Intake QA 20260915 LLC'
  AND d.created_at >= '2026-09-15T18:30:00Z' AND d.created_at < '2026-09-15T19:30:00Z'
  AND EXISTS (
    SELECT 1 FROM public.borrower_concierge_sessions c
    WHERE c.deal_id = d.id
      AND c.conversation_history->0->>'content' =
      'This is a synthetic QA application for Codex Guided Intake QA 20260915 LLC. We are testing the loan questionnaire. No real borrower, email contact, or lender submission.'
  );

