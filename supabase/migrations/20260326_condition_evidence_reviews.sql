-- Phase 54C: Condition Evidence Review Queue
-- Tracks banker review of ambiguous, rejected, or clarification-needed evidence.
-- Separate from condition_document_links — reviews are a workflow layer, not just a link.

CREATE TABLE IF NOT EXISTS public.condition_evidence_reviews (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                  uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id                  uuid NOT NULL,
  condition_id             uuid NOT NULL,
  document_id              uuid NOT NULL,
  condition_document_link_id uuid,

  review_state             text NOT NULL DEFAULT 'queued_for_review'
    CHECK (review_state IN (
      'queued_for_review',
      'in_review',
      'accepted',
      'partially_accepted',
      'rejected',
      'clarification_requested',
      'waived'
    )),

  review_reason_category   text
    CHECK (review_reason_category IS NULL OR review_reason_category IN (
      'wrong_document_type',
      'wrong_date_range',
      'wrong_entity',
      'incomplete_document',
      'unreadable',
      'missing_signature_or_page',
      'insufficient_detail',
      'conflicting_information',
      'clarification_needed',
      'duplicate_submission',
      'policy_exception',
      'auto_ambiguity',
      'other'
    )),

  source_of_flag           text NOT NULL DEFAULT 'auto_ambiguity'
    CHECK (source_of_flag IN (
      'auto_ambiguity',
      'auto_rejection',
      'banker_manual',
      'borrower_follow_up'
    )),

  classifier_confidence    numeric(5,4),
  ambiguity_flags          jsonb,
  explanation_internal      text,
  explanation_borrower_safe text,
  requested_clarification   text,

  reviewer_user_id         text,
  reviewer_membership_id   uuid,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  reviewed_at              timestamptz,
  resolution_applied_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cer_deal_id ON public.condition_evidence_reviews(deal_id);
CREATE INDEX IF NOT EXISTS idx_cer_bank_id ON public.condition_evidence_reviews(bank_id);
CREATE INDEX IF NOT EXISTS idx_cer_condition_id ON public.condition_evidence_reviews(condition_id);
CREATE INDEX IF NOT EXISTS idx_cer_review_state ON public.condition_evidence_reviews(review_state);
CREATE INDEX IF NOT EXISTS idx_cer_reviewer ON public.condition_evidence_reviews(reviewer_user_id);
CREATE INDEX IF NOT EXISTS idx_cer_created_desc ON public.condition_evidence_reviews(created_at DESC);

ALTER TABLE public.condition_evidence_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.condition_evidence_reviews
  FOR ALL USING (true) WITH CHECK (true);
