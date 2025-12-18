-- Production-Ready SBA System - Additional Tables
-- Run in Supabase SQL Editor

-- E-Tran Submissions (Human-Approved)
CREATE TABLE IF NOT EXISTS etran_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  xml TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'SUBMITTED', 'APPROVED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  submitted_by TEXT,
  metadata JSONB,
  sba_response JSONB,
  sba_loan_number TEXT,
  created_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_etran_submissions_app ON etran_submissions(application_id);
CREATE INDEX idx_etran_submissions_status ON etran_submissions(status);
CREATE INDEX idx_etran_submissions_created ON etran_submissions(created_at DESC);

-- E-Tran Readiness (Simple Gate Checks)
CREATE TABLE IF NOT EXISTS etran_readiness (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  ready BOOLEAN NOT NULL,
  blockers JSONB NOT NULL DEFAULT '[]',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_etran_readiness_app ON etran_readiness(application_id);
CREATE INDEX idx_etran_readiness_ready ON etran_readiness(ready);

-- Borrower Communications (AI-Drafted, Human-Approved)
CREATE TABLE IF NOT EXISTS borrower_comms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL', 'SMS', 'PORTAL')),
  subject TEXT,
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'SENT', 'FAILED')),
  sent_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ
);

CREATE INDEX idx_borrower_comms_app ON borrower_comms(application_id);
CREATE INDEX idx_borrower_comms_status ON borrower_comms(status);
CREATE INDEX idx_borrower_comms_created ON borrower_comms(created_at DESC);

-- Generated Documents (PDFs, Memos, etc.)
CREATE TABLE IF NOT EXISTS generated_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('PDF_FORM', 'CREDIT_MEMO', 'E_TRAN_XML', 'NARRATIVE', 'PACKAGE')),
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  version TEXT,
  metadata JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by UUID REFERENCES auth.users(id)
);

CREATE INDEX idx_generated_docs_app ON generated_documents(application_id);
CREATE INDEX idx_generated_docs_type ON generated_documents(artifact_type);
CREATE INDEX idx_generated_docs_created ON generated_documents(generated_at DESC);

-- Tenant Configuration (Multi-Bank Support)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  brand_config JSONB NOT NULL DEFAULT '{}',
  etran_config JSONB NOT NULL DEFAULT '{}',
  features JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_active ON tenants(active);

-- Add tenant_id to applications if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'applications' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE applications ADD COLUMN tenant_id UUID REFERENCES tenants(id);
    CREATE INDEX idx_applications_tenant ON applications(tenant_id);
  END IF;
END $$;

-- Row Level Security Policies
ALTER TABLE etran_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE etran_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE borrower_comms ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Tenants: Admins can see all, users can see their tenant
CREATE POLICY tenant_select_policy ON tenants
  FOR SELECT
  USING (active = true);

-- E-Tran Submissions: Tenant-scoped
CREATE POLICY etran_submissions_select_policy ON etran_submissions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = etran_submissions.application_id
    )
  );

-- Borrower Comms: Tenant-scoped
CREATE POLICY borrower_comms_select_policy ON borrower_comms
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = borrower_comms.application_id
    )
  );

-- Generated Documents: Tenant-scoped
CREATE POLICY generated_documents_select_policy ON generated_documents
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = generated_documents.application_id
    )
  );

-- Insert default demo tenant
INSERT INTO tenants (slug, name, brand_config, etran_config, features)
VALUES (
  'demo',
  'Demo Bank',
  '{"logo_url": "", "primary_color": "#0066CC", "company_name": "Demo Bank", "support_email": "sba@demo.com"}',
  '{"lender_id": "DEMO001", "service_center": "SACRAMENTO", "enabled": false}',
  '{"auto_narrative": true, "auto_agents": true, "borrower_portal": true}'
)
ON CONFLICT (slug) DO NOTHING;

-- Trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_etran_submissions_updated_at
  BEFORE UPDATE ON etran_submissions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
