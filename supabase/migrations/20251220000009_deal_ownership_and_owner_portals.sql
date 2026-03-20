-- 20251220_deal_ownership_and_owner_portals.sql

-- ------------------------------------------------------------
-- Deal Owners (canonical source of ownership truth)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,

  full_name text NOT NULL,
  email text NULL,
  phone text NULL,

  -- ownership can be unknown initially
  ownership_percent numeric(6,3) NULL, -- e.g. 20.000
  ownership_source text NOT NULL DEFAULT 'unknown' CHECK (ownership_source IN ('unknown','borrower_entered','banker_entered','doc_inferred')),
  ownership_confidence numeric(4,3) NULL, -- 0.000 - 1.000 (only for inferred)

  -- whether owner is required for 20% rule
  requires_personal_package boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_owners_deal_idx ON public.deal_owners(deal_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_deal_owners_updated_at ON public.deal_owners;
CREATE TRIGGER trg_deal_owners_updated_at
BEFORE UPDATE ON public.deal_owners
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- Owner Portal Links (separate portal identity per owner)
-- Canonical: this is NOT the main borrower; these are additional principals.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_owner_portals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.deal_owners(id) ON DELETE CASCADE,

  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','completed','revoked')),
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_owner_portals_deal_idx ON public.deal_owner_portals(deal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS deal_owner_portals_owner_idx ON public.deal_owner_portals(owner_id);
CREATE INDEX IF NOT EXISTS deal_owner_portals_token_idx ON public.deal_owner_portals(token);

DROP TRIGGER IF EXISTS trg_deal_owner_portals_updated_at ON public.deal_owner_portals;
CREATE TRIGGER trg_deal_owner_portals_updated_at
BEFORE UPDATE ON public.deal_owner_portals
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- Owner Checklist Items (per owner, not shared)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_owner_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.deal_owners(id) ON DELETE CASCADE,

  code text NOT NULL, -- e.g. "PFS", "PERS_TAX_2024"
  title text NOT NULL, -- borrower-friendly
  description text NULL,
  sort_order int NOT NULL DEFAULT 0,
  required boolean NOT NULL DEFAULT true,

  match_hints jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deal_owner_checklist_items_unique UNIQUE (owner_id, code)
);

CREATE INDEX IF NOT EXISTS deal_owner_checklist_items_owner_idx
  ON public.deal_owner_checklist_items(owner_id, sort_order);

DROP TRIGGER IF EXISTS trg_deal_owner_checklist_items_updated_at ON public.deal_owner_checklist_items;
CREATE TRIGGER trg_deal_owner_checklist_items_updated_at
BEFORE UPDATE ON public.deal_owner_checklist_items
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Owner Checklist State (per owner+item)
CREATE TABLE IF NOT EXISTS public.deal_owner_checklist_state (
  owner_id uuid NOT NULL REFERENCES public.deal_owners(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.deal_owner_checklist_items(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('missing','received','verified')) DEFAULT 'missing',
  completed_at timestamptz NULL,
  last_receipt_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, item_id)
);

CREATE INDEX IF NOT EXISTS deal_owner_checklist_state_owner_idx
  ON public.deal_owner_checklist_state(owner_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_deal_owner_checklist_state_updated_at ON public.deal_owner_checklist_state;
CREATE TRIGGER trg_deal_owner_checklist_state_updated_at
BEFORE UPDATE ON public.deal_owner_checklist_state
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- Owner Outreach Queue (email requests + updates) - server processes it
-- No automatic emailing from client; server sends using your existing email system.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_owner_outreach_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.deal_owners(id) ON DELETE CASCADE,

  kind text NOT NULL CHECK (kind IN ('invite','reminder','update')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')),

  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,

  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz NULL,
  last_error text NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_owner_outreach_queue_status_idx
  ON public.deal_owner_outreach_queue(status, scheduled_at);

-- ------------------------------------------------------------
-- RLS: deny all (server-only)
-- ------------------------------------------------------------
ALTER TABLE public.deal_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_owner_portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_owner_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_owner_checklist_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_owner_outreach_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_owners_none ON public.deal_owners;
CREATE POLICY deal_owners_none ON public.deal_owners FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_owner_portals_none ON public.deal_owner_portals;
CREATE POLICY deal_owner_portals_none ON public.deal_owner_portals FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_owner_checklist_items_none ON public.deal_owner_checklist_items;
CREATE POLICY deal_owner_checklist_items_none ON public.deal_owner_checklist_items FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_owner_checklist_state_none ON public.deal_owner_checklist_state;
CREATE POLICY deal_owner_checklist_state_none ON public.deal_owner_checklist_state FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_owner_outreach_queue_none ON public.deal_owner_outreach_queue;
CREATE POLICY deal_owner_outreach_queue_none ON public.deal_owner_outreach_queue FOR ALL USING (false) WITH CHECK (false);
