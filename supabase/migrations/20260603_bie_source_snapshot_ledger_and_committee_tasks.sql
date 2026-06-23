-- SPEC-BIE-SOURCE-SNAPSHOT-LEDGER-AND-OFFICIAL-SOURCE-CONNECTORS-1
-- First evidence-collection layer: a source snapshot ledger + committee evidence
-- tasks, each linked to a committee_blocker_resolution.blocker_id. Service-role
-- written (RLS off, like buddy_research_quality_gates). Does NOT change scoring,
-- gate semantics, or committee thresholds — collection only.

-- ── Source snapshot ledger ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buddy_research_source_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id    uuid NOT NULL,
  deal_id       uuid,
  source_url    text NOT NULL,
  source_type   text,                                   -- e.g. borrower_official_website
  status        text NOT NULL DEFAULT 'collected'
                  CHECK (status IN ('pending','collected','failed')),
  http_status   integer,
  content_hash  text,                                   -- sha256 of fetched body
  content_type  text,
  title         text,
  byte_size     integer,
  error         text,
  fetched_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_brss_mission ON public.buddy_research_source_snapshots (mission_id);
CREATE INDEX IF NOT EXISTS idx_brss_deal ON public.buddy_research_source_snapshots (deal_id);

-- ── Committee evidence tasks ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buddy_research_committee_tasks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id         uuid NOT NULL,
  deal_id            uuid,
  blocker_id         text NOT NULL,                     -- committee_blocker_resolution.blocker_id
  blocker_type       text,
  task_type          text NOT NULL,                     -- borrower_website_snapshot | sos_business_registry |
                                                         -- public_adverse_screen | management_attestation |
                                                         -- industry_market_source | competitive_source |
                                                         -- financial_file | manual_review
  title              text,
  instructions       text,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','collected','accepted','rejected')),
  auto_collectible   boolean NOT NULL DEFAULT false,
  target_url         text,
  source_snapshot_id uuid REFERENCES public.buddy_research_source_snapshots(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- idempotent generation: one task per (mission, blocker, task_type)
  UNIQUE (mission_id, blocker_id, task_type)
);
CREATE INDEX IF NOT EXISTS idx_brct_mission ON public.buddy_research_committee_tasks (mission_id);
CREATE INDEX IF NOT EXISTS idx_brct_deal ON public.buddy_research_committee_tasks (deal_id);
CREATE INDEX IF NOT EXISTS idx_brct_blocker ON public.buddy_research_committee_tasks (mission_id, blocker_id);
