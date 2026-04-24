ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS borrower_email text,
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'banker_created'
    CHECK (origin IN ('banker_created','brokerage_anonymous','brokerage_claimed'));

COMMENT ON COLUMN public.deals.origin IS
  'How this deal was created. banker_created = existing bank SaaS flow. brokerage_anonymous = draft from /start concierge, pre-email. brokerage_claimed = borrower provided email, now a full brokerage lead.';

CREATE INDEX IF NOT EXISTS deals_origin_idx ON public.deals (origin);
CREATE INDEX IF NOT EXISTS deals_borrower_email_idx
  ON public.deals (borrower_email) WHERE borrower_email IS NOT NULL;
