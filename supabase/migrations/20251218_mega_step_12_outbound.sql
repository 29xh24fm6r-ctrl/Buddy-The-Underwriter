/**
 * MEGA STEP 12: Missing Docs Outbound Schema
 * 
 * Tables:
 * 1. deal_outbound_settings: Per-deal auto-send configuration
 * 2. deal_outbound_ledger: Audit trail of all sent emails
 * 
 * Integration: processMissingDocsOutbound() called at end of reconciliation
 */

-- 1. Outbound settings (per deal)
CREATE TABLE IF NOT EXISTS public.deal_outbound_settings (
  deal_id UUID PRIMARY KEY REFERENCES public.deals(id) ON DELETE CASCADE,
  auto_send BOOLEAN NOT NULL DEFAULT false,
  throttle_minutes INTEGER NOT NULL DEFAULT 240,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deal_outbound_settings_auto_send ON public.deal_outbound_settings(auto_send) WHERE auto_send = true;

COMMENT ON TABLE public.deal_outbound_settings IS 'Per-deal configuration for auto-sending missing docs emails';
COMMENT ON COLUMN public.deal_outbound_settings.auto_send IS 'If true, processMissingDocsOutbound() will auto-send emails (with throttle)';
COMMENT ON COLUMN public.deal_outbound_settings.throttle_minutes IS 'Minimum minutes between auto-sends for same kind (default 240 = 4 hours)';

-- 2. Outbound ledger (audit trail)
CREATE TABLE IF NOT EXISTS public.deal_outbound_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- e.g., "MISSING_DOCS_REQUEST"
  fingerprint TEXT NOT NULL, -- sha256(dealId|kind|subject|body) for deduplication
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  provider TEXT NOT NULL, -- e.g., "stub", "resend", "sendgrid"
  provider_message_id TEXT, -- External ID from email provider
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deal_outbound_ledger_deal_kind ON public.deal_outbound_ledger(deal_id, kind, created_at DESC);
CREATE INDEX idx_deal_outbound_ledger_fingerprint ON public.deal_outbound_ledger(fingerprint);

COMMENT ON TABLE public.deal_outbound_ledger IS 'Audit trail of all outbound emails (sent + failed)';
COMMENT ON COLUMN public.deal_outbound_ledger.fingerprint IS 'Unique hash of email content (prevents duplicate sends)';
COMMENT ON COLUMN public.deal_outbound_ledger.provider_message_id IS 'External message ID from email provider (for tracking deliverability)';

-- 3. Grant permissions
GRANT SELECT, INSERT, UPDATE ON public.deal_outbound_settings TO service_role;
GRANT SELECT, INSERT ON public.deal_outbound_ledger TO service_role;
