-- Condition-Aware Messaging System Tables

-- Message Throttles (rules-based spam prevention)
CREATE TABLE IF NOT EXISTS condition_message_throttles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  condition_id UUID NOT NULL REFERENCES conditions_to_close(id) ON DELETE CASCADE,
  send_count INTEGER NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  last_message_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(application_id, condition_id)
);

CREATE INDEX idx_throttles_app ON condition_message_throttles(application_id);
CREATE INDEX idx_throttles_condition ON condition_message_throttles(condition_id);
CREATE INDEX idx_throttles_last_sent ON condition_message_throttles(last_sent_at DESC);

-- Condition Messages (drafts + sent messages)
CREATE TABLE IF NOT EXISTS condition_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  condition_id UUID NOT NULL REFERENCES conditions_to_close(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL', 'PORTAL', 'SMS')),
  direction TEXT NOT NULL DEFAULT 'OUTBOUND' CHECK (direction IN ('OUTBOUND', 'INBOUND')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'QUEUED', 'SENT', 'FAILED', 'SKIPPED')),
  subject TEXT,
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),
  trigger_type TEXT,
  ai_generated BOOLEAN NOT NULL DEFAULT false,
  requires_approval BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_app ON condition_messages(application_id);
CREATE INDEX idx_messages_condition ON condition_messages(condition_id);
CREATE INDEX idx_messages_status ON condition_messages(status);
CREATE INDEX idx_messages_channel ON condition_messages(channel);
CREATE INDEX idx_messages_created ON condition_messages(created_at DESC);

-- Portal Notifications (in-app)
CREATE TABLE IF NOT EXISTS portal_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_portal_notif_app ON portal_notifications(application_id);
CREATE INDEX idx_portal_notif_read ON portal_notifications(read);
CREATE INDEX idx_portal_notif_created ON portal_notifications(created_at DESC);

-- Email Queue (for future provider integration)
CREATE TABLE IF NOT EXISTS email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX idx_email_queue_status ON email_queue(status);
CREATE INDEX idx_email_queue_created ON email_queue(created_at DESC);

-- RLS Policies
ALTER TABLE condition_message_throttles ENABLE ROW LEVEL SECURITY;
ALTER TABLE condition_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY condition_messages_select_policy ON condition_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = condition_messages.application_id
    )
  );

CREATE POLICY portal_notifications_select_policy ON portal_notifications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = portal_notifications.application_id
    )
  );
