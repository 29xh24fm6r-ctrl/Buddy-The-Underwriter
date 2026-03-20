-- =========================================================
-- SMS Helper Functions + Timeline Integration
-- =========================================================

-- Normalize E.164 phone numbers (SQL version for DB queries)
CREATE OR REPLACE FUNCTION public.normalize_e164(p TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    ELSE regexp_replace(trim(p), '[^0-9+]', '', 'g')
  END;
$$;

-- Resolve SMS context using borrower_phone_links table
-- This uses our superior borrower_phone_links architecture (not borrower_applicants.phone_e164)
CREATE OR REPLACE FUNCTION public.resolve_sms_context(p_from_e164 TEXT)
RETURNS TABLE (
  borrower_applicant_id UUID,
  borrower_id UUID,
  deal_id UUID,
  bank_id UUID
)
LANGUAGE PLPGSQL
STABLE
AS $$
DECLARE
  v_from TEXT := public.normalize_e164(p_from_e164);
BEGIN
  IF v_from IS NULL OR v_from = '' THEN
    RETURN;
  END IF;

  -- Query borrower_phone_links (our canonical phone→deal mapping)
  RETURN QUERY
  SELECT 
    bpl.borrower_applicant_id,
    NULL::UUID as borrower_id,  -- Can be enhanced later if needed
    bpl.deal_id,
    bpl.bank_id
  FROM public.borrower_phone_links bpl
  WHERE public.normalize_e164(bpl.phone_e164) = v_from
  ORDER BY bpl.created_at DESC
  LIMIT 1;
END $$;

-- Timeline integration: deal_events → deal_timeline_events (if table exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='deal_timeline_events'
  ) THEN

    CREATE OR REPLACE FUNCTION public.deal_events_to_timeline()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS $fn$
    BEGIN
      -- Only create timeline events for SMS events with a deal_id
      IF NEW.deal_id IS NULL THEN
        RETURN NEW;
      END IF;

      IF NEW.kind NOT LIKE 'sms_%' THEN
        RETURN NEW;
      END IF;

      INSERT INTO public.deal_timeline_events (
        id,
        deal_id,
        created_at,
        kind,
        meta
      )
      VALUES (
        gen_random_uuid(),
        NEW.deal_id,
        COALESCE(NEW.created_at, NOW()),
        NEW.kind,
        jsonb_build_object(
          'deal_event_id', NEW.id,
          'description', NEW.description,
          'metadata', NEW.metadata
        )
      )
      ON CONFLICT DO NOTHING;

      RETURN NEW;
    END $fn$;

    DROP TRIGGER IF EXISTS trg_deal_events_to_timeline ON public.deal_events;

    CREATE TRIGGER trg_deal_events_to_timeline
    AFTER INSERT ON public.deal_events
    FOR EACH ROW
    EXECUTE FUNCTION public.deal_events_to_timeline();

  END IF;
END $$;

COMMENT ON FUNCTION public.normalize_e164(TEXT) IS 
  'Normalize phone number to E.164 format (strip spaces, parens, dashes)';

COMMENT ON FUNCTION public.resolve_sms_context(TEXT) IS 
  'Resolve phone number to borrower/deal context via borrower_phone_links table';
