-- ============================================================================
-- Identity Registry — Layer 2 v1.0
--
-- Authoritative source of truth for deal entity identities.
-- Entity resolution (6-tier deterministic scoring) resolves documents
-- against this registry. v1.0: observability only — no slot enforcement.
-- ============================================================================

create table if not exists deal_entities (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references deals(id) on delete cascade,

  entity_kind text not null check (
    entity_kind in ('OPCO', 'PROPCO', 'HOLDCO', 'PERSON', 'GROUP')
  ),

  name        text not null,
  legal_name  text,
  ein         text,

  -- meta carries ssn_last4 for PERSON entities (never full SSN)
  meta        jsonb default '{}',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_identity_registry_deal
  on deal_entities(deal_id);
