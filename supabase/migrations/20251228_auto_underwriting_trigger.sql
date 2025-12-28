-- Auto-Underwriting Trigger System
-- Detects when all required checklist items are received
-- Emits 'deal_ready_for_underwriting' event automatically

-- Function: Check if deal is ready for underwriting
CREATE OR REPLACE FUNCTION check_deal_ready_for_underwriting()
RETURNS TRIGGER AS $$
DECLARE
  v_required_count INT;
  v_received_count INT;
  v_already_emitted BOOL;
BEGIN
  -- Count required items
  SELECT COUNT(*) INTO v_required_count
  FROM deal_checklist_items
  WHERE deal_id = NEW.deal_id
    AND required = true;

  -- Count received required items
  SELECT COUNT(*) INTO v_received_count
  FROM deal_checklist_items
  WHERE deal_id = NEW.deal_id
    AND required = true
    AND received_at IS NOT NULL;

  -- Check if we've already emitted this event
  SELECT EXISTS(
    SELECT 1 FROM deal_events
    WHERE deal_id = NEW.deal_id
      AND kind = 'deal_ready_for_underwriting'
  ) INTO v_already_emitted;

  -- If all required items received AND we haven't emitted yet
  IF v_required_count > 0 
     AND v_received_count = v_required_count 
     AND NOT v_already_emitted THEN
    
    -- Emit the event
    INSERT INTO deal_events (
      deal_id,
      kind,
      metadata
    ) VALUES (
      NEW.deal_id,
      'deal_ready_for_underwriting',
      jsonb_build_object(
        'required_count', v_required_count,
        'received_count', v_received_count,
        'triggered_by', 'checklist_completion',
        'timestamp', NOW()
      )
    );

    -- Update deal status if deals table has status column
    -- (Uncomment if you have this column)
    -- UPDATE deals 
    -- SET status = 'ready_for_underwriting'
    -- WHERE id = NEW.deal_id;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Fire after checklist item received_at update
DROP TRIGGER IF EXISTS on_checklist_received_check_ready ON deal_checklist_items;
CREATE TRIGGER on_checklist_received_check_ready
  AFTER UPDATE OF received_at ON deal_checklist_items
  FOR EACH ROW
  WHEN (NEW.received_at IS NOT NULL AND OLD.received_at IS NULL)
  EXECUTE FUNCTION check_deal_ready_for_underwriting();

-- Add notification queue table
CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  event_id UUID REFERENCES deal_events(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL, -- 'email', 'sms', 'in_app'
  recipient TEXT NOT NULL, -- email or phone
  subject TEXT,
  body TEXT NOT NULL,
  template_key TEXT, -- for template-based notifications
  metadata JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending', -- pending, sent, failed, skipped
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notification_queue_status ON notification_queue(status) WHERE status = 'pending';
CREATE INDEX idx_notification_queue_deal ON notification_queue(deal_id);
CREATE INDEX idx_notification_queue_created ON notification_queue(created_at DESC);

-- Add notification_sent event tracking
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID REFERENCES notification_queue(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL, -- sent, failed, bounced
  provider TEXT, -- resend, twilio, etc.
  provider_response JSONB,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notification_log_queue ON notification_log(queue_id);
CREATE INDEX idx_notification_log_sent ON notification_log(sent_at DESC);

COMMENT ON TABLE notification_queue IS 'Queue for outbound notifications triggered by deal events';
COMMENT ON TABLE notification_log IS 'Audit log of all notification attempts';
