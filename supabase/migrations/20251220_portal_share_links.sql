-- 20251220_portal_share_links.sql

-- Scoped upload links that can be forwarded to third parties (accountant/bookkeeper)
CREATE TABLE IF NOT EXISTS public.deal_portal_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,

  -- Who created this link (borrower portal user) - optional string identifier
  created_by text NULL,

  -- scope (borrower-safe)
  scope text NOT NULL CHECK (scope IN ('checklist_items')),
  checklist_item_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],

  -- token + expiry
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,

  -- display (borrower-safe)
  recipient_name text NULL,
  note text NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_portal_share_links_deal_idx
  ON public.deal_portal_share_links(deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS deal_portal_share_links_token_idx
  ON public.deal_portal_share_links(token);

-- RLS deny all (server-only)
ALTER TABLE public.deal_portal_share_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_portal_share_links_none ON public.deal_portal_share_links;
CREATE POLICY deal_portal_share_links_none ON public.deal_portal_share_links
FOR ALL USING (false) WITH CHECK (false);
