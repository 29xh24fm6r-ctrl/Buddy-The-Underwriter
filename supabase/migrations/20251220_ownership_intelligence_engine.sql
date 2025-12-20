-- 20251220_ownership_intelligence_engine.sql

-- ------------------------------------------------------------
-- 1) Canonical owners (truth after confirmation)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,

  full_name text NOT NULL,
  email text NULL,
  phone text NULL,

  ownership_percent numeric(6,3) NULL,
  ownership_source text NOT NULL DEFAULT 'unknown'
    CHECK (ownership_source IN ('unknown','borrower_confirmed','banker_entered','doc_inferred')),
  ownership_confidence numeric(4,3) NULL, -- 0..1 for inferred

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
-- 2) Ownership findings (proposed owners with evidence)
-- borrower-safe evidence: doc label + page + short snippet
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_ownership_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,

  full_name text NOT NULL,
  email text NULL,

  ownership_percent numeric(6,3) NULL,

  evidence_doc_id uuid NULL,
  evidence_doc_label text NULL,
  evidence_page int NULL,
  evidence_snippet text NULL,

  confidence numeric(4,3) NOT NULL DEFAULT 0.50,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','confirmed','rejected')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_ownership_findings_deal_idx
  ON public.deal_ownership_findings(deal_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_deal_ownership_findings_updated_at ON public.deal_ownership_findings;
CREATE TRIGGER trg_deal_ownership_findings_updated_at
BEFORE UPDATE ON public.deal_ownership_findings
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 3) Owner portals (separate principal portals)
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
-- 4) Owner checklist + state (per owner)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_owner_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.deal_owners(id) ON DELETE CASCADE,

  code text NOT NULL, -- "PFS", "PERS_TAX_YYYY", "PERSONAL_GUARANTY"
  title text NOT NULL,
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
-- 5) Owner outreach queue (server tick sends emails)
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
-- RLS deny all (server only)
-- ------------------------------------------------------------
ALTER TABLE public.deal_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_ownership_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_owner_portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_owner_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_owner_checklist_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_owner_outreach_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_owners_none ON public.deal_owners;
CREATE POLICY deal_owners_none ON public.deal_owners FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_ownership_findings_none ON public.deal_ownership_findings;
CREATE POLICY deal_ownership_findings_none ON public.deal_ownership_findings FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_owner_portals_none ON public.deal_owner_portals;
CREATE POLICY deal_owner_portals_none ON public.deal_owner_portals FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_owner_checklist_items_none ON public.deal_owner_checklist_items;
CREATE POLICY deal_owner_checklist_items_none ON public.deal_owner_checklist_items FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_owner_checklist_state_none ON public.deal_owner_checklist_state;
CREATE POLICY deal_owner_checklist_state_none ON public.deal_owner_checklist_state FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_owner_outreach_queue_none ON public.deal_owner_outreach_queue;
CREATE POLICY deal_owner_outreach_queue_none ON public.deal_owner_outreach_queue FOR ALL USING (false) WITH CHECK (false);
