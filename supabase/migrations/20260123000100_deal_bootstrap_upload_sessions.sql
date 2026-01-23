-- Deal bootstrap upload sessions + intake state

ALTER TABLE deals
ADD COLUMN IF NOT EXISTS intake_state text NOT NULL DEFAULT 'CREATED';

CREATE TABLE IF NOT EXISTS deal_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  created_by text NULL,
  metadata jsonb NULL
);

CREATE INDEX IF NOT EXISTS idx_deal_upload_sessions_deal_id ON deal_upload_sessions(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_upload_sessions_bank_id ON deal_upload_sessions(bank_id);

CREATE TABLE IF NOT EXISTS deal_upload_session_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES deal_upload_sessions(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL,
  file_id text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  object_key text NOT NULL,
  bucket text NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_upload_session_files_session_file
  ON deal_upload_session_files(session_id, file_id);

CREATE INDEX IF NOT EXISTS idx_deal_upload_session_files_session
  ON deal_upload_session_files(session_id);

CREATE OR REPLACE FUNCTION public.deal_bootstrap_create(
  p_bank_id uuid,
  p_name text,
  p_created_by text
)
RETURNS TABLE(deal_id uuid, session_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
AS $$
DECLARE
  v_deal_id uuid := gen_random_uuid();
  v_session_id uuid := gen_random_uuid();
  v_expires_at timestamptz := now() + interval '30 minutes';
BEGIN
  INSERT INTO deals (id, bank_id, name, borrower_name, created_at, updated_at, intake_state)
  VALUES (v_deal_id, p_bank_id, p_name, p_name, now(), now(), 'UPLOAD_SESSION_READY');

  INSERT INTO deal_upload_sessions (id, deal_id, bank_id, created_at, expires_at, status, created_by)
  VALUES (v_session_id, v_deal_id, p_bank_id, now(), v_expires_at, 'ready', p_created_by);

  RETURN QUERY SELECT v_deal_id, v_session_id, v_expires_at;
END;
$$;
