-- Phase 57: Closing Execution System
-- See migration applied via Supabase MCP tool above.
-- Tables: closing_execution_runs, closing_document_recipients, closing_document_actions,
-- closing_condition_states, funding_authorizations

-- 1. Execution runs
CREATE TABLE IF NOT EXISTS public.closing_execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_package_id uuid NOT NULL REFERENCES public.closing_packages(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready_to_send','sent','partially_signed','fully_signed','conditions_pending','execution_complete','cancelled','superseded')),
  execution_started_at timestamptz,
  execution_completed_at timestamptz,
  cancelled_at timestamptz,
  superseded_by_execution_run_id uuid,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(closing_package_id)
);

-- 2. Document recipients
CREATE TABLE IF NOT EXISTS public.closing_document_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_package_document_id uuid NOT NULL REFERENCES public.closing_package_documents(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  recipient_role text NOT NULL CHECK (recipient_role IN ('borrower','guarantor','banker','bank_counsel','borrower_counsel','title_company','insurance_agent','other')),
  recipient_name text, recipient_email text, recipient_entity text,
  action_type text NOT NULL CHECK (action_type IN ('sign','review','receive','upload_back')),
  routing_order int NOT NULL DEFAULT 1,
  required boolean NOT NULL DEFAULT true,
  provider_recipient_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','viewed','signed','completed','waived','failed')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Document actions (audit)
CREATE TABLE IF NOT EXISTS public.closing_document_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  closing_package_id uuid NOT NULL REFERENCES public.closing_packages(id) ON DELETE CASCADE,
  closing_package_document_id uuid REFERENCES public.closing_package_documents(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES public.closing_document_recipients(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN ('prepared','sent','resent','viewed','signed','completed','voided','downloaded','uploaded_counterpart','waived','failed','superseded')),
  actor_user_id text, actor_type text CHECK (actor_type IN ('banker','borrower','system','provider')),
  provider_name text, provider_envelope_id text, notes text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Closing condition states
CREATE TABLE IF NOT EXISTS public.closing_condition_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_package_id uuid NOT NULL REFERENCES public.closing_packages(id) ON DELETE CASCADE,
  closing_checklist_item_id uuid REFERENCES public.closing_checklist_items(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  condition_code text NOT NULL, title text NOT NULL, description text,
  category text NOT NULL CHECK (category IN ('document','signature','insurance','collateral','authority','disbursement','other')),
  required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','satisfied','waived','blocked')),
  satisfied_at timestamptz, satisfied_by text, evidence jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Funding authorizations
CREATE TABLE IF NOT EXISTS public.funding_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  closing_package_id uuid NOT NULL REFERENCES public.closing_packages(id) ON DELETE CASCADE,
  closing_execution_run_id uuid NOT NULL REFERENCES public.closing_execution_runs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','authorized','revoked')),
  authorized_by text, authorized_at timestamptz, revoked_by text, revoked_at timestamptz, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS + indexes omitted for brevity (applied in Supabase MCP migration above)
