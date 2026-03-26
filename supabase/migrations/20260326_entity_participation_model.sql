-- Phase 56A: Entity Participation Model
-- Separates canonical entity identity (ownership_entities / deal_entities)
-- from deal participation role. One entity can participate in multiple roles.
-- Named deal_entity_participations to avoid collision with existing deal_entities.

CREATE TABLE IF NOT EXISTS public.deal_entity_participations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id              uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  ownership_entity_id  uuid NOT NULL REFERENCES public.ownership_entities(id) ON DELETE CASCADE,
  role_key             text NOT NULL,
  is_primary           boolean NOT NULL DEFAULT false,
  ownership_pct        numeric,
  guaranty_type        text,
  guaranty_amount      numeric,
  title                text,
  participation_data   jsonb NOT NULL DEFAULT '{}',
  completed            boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE(deal_id, ownership_entity_id, role_key)
);

CREATE INDEX IF NOT EXISTS idx_dep_deal_id ON public.deal_entity_participations(deal_id);
CREATE INDEX IF NOT EXISTS idx_dep_entity_id ON public.deal_entity_participations(ownership_entity_id);
CREATE INDEX IF NOT EXISTS idx_dep_role ON public.deal_entity_participations(deal_id, role_key);

-- Entity-to-document linking
CREATE TABLE IF NOT EXISTS public.deal_entity_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id             uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  participation_id    uuid NOT NULL REFERENCES public.deal_entity_participations(id) ON DELETE CASCADE,
  document_id         uuid NOT NULL,
  doc_purpose         text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ded_participation ON public.deal_entity_documents(participation_id);
CREATE INDEX IF NOT EXISTS idx_ded_document ON public.deal_entity_documents(document_id);

-- Collateral-to-document linking
CREATE TABLE IF NOT EXISTS public.deal_collateral_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id             uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  collateral_item_id  uuid NOT NULL,
  document_id         uuid NOT NULL,
  doc_purpose         text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dcd_collateral ON public.deal_collateral_documents(collateral_item_id);
CREATE INDEX IF NOT EXISTS idx_dcd_document ON public.deal_collateral_documents(document_id);

-- RLS
ALTER TABLE public.deal_entity_participations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_entity_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_collateral_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.deal_entity_participations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.deal_entity_documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.deal_collateral_documents FOR ALL USING (true) WITH CHECK (true);
